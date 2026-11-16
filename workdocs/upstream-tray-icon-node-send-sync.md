# Upstream issue draft — `unsafe impl Send/Sync for AnyMenuItem`

**Status:** READY TO FILE at the next upstream sync. Do **not** file from the decaf-ts repository.
**Target repository:** `nglmercer/tray-icon-node`
**Analyzed revision:** `cb91e86184ed8612bcdee904277b4d5e78d966c3` (package `0.1.2`)
**Affected file:** `src/menu.rs` (enum `AnyMenuItem`, lines 8–22 at the analyzed revision)
**Prepared by:** decaf-ts/for-os vendored-source audit (internal tracking: SAA-1661 under SAA-1658).
**Finding class:** soundness / undefined behavior, latent (no cross-thread use exists in the crate today).
**Suggested upstream labels:** `soundness`, `bug` (or `unsafe`).

Provenance of the finding: `@decaf-ts/for-os` vendors this crate for auditability
(`for-os/native/tray-icon-node/UPSTREAM.md`). The same `unsafe impl` also exists in the
`with-ai` vendored copy. Removing it is a source change and is deliberately not done in the
downstream copy until the upstream disposition is decided.

---

## Issue title

unsound: `unsafe impl Send/Sync for AnyMenuItem` wraps `Rc<RefCell<..>>` menu handles

## Summary

`src/menu.rs` force-implements `Send` and `Sync` for `AnyMenuItem`:

```rust
pub enum AnyMenuItem {
    Standard(tray_menu::MenuItem),
    Check(tray_menu::CheckMenuItem),
    Icon(tray_menu::IconMenuItem),
    Submenu(Submenu),
}

// SAFETY: All variants of `AnyMenuItem` wrap types from the `tray-icon` crate,
// which guarantees `Send + Sync` safety across all supported platforms (Windows, macOS, Linux).
// The underlying OS handles (HMENU, NSMenu, GtkMenu) are reference-counted and safe to move
// between threads for read-only operations. Mutable access is protected by the `Mutex` in `Menu`.
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for AnyMenuItem {}
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Sync for AnyMenuItem {}
```

The underlying `tray-icon` / `muda` menu-item handles are **not** `Send` or `Sync`, and
`tray-icon` does not guarantee that they are. `AnyMenuItem` is sound to treat as `Send`/`Sync`
only if all of the following hold, and none of them do:

1. Every clone/drop of the handles is atomic or otherwise thread-safe.
2. Every read and write of the shared menu-item state is synchronized and race-free.
3. Every platform menu/GTK/AppKit call is made on the thread that owns the menu and event loop.
4. Dropping the last handle from any thread is safe (teardown stays on the owning thread).

The impls therefore permit safe code inside the crate to produce data races, aliasing
`&mut` references, and GUI calls from the wrong thread (undefined behavior), while telling the
compiler not to reject such code. There is no cross-thread use in the crate today, so this is a
latent soundness bug rather than an observed crash, but the impl is unjustified and removes the
compiler's ability to catch a future regression.

## Affected code

- `src/menu.rs`: `AnyMenuItem` + `unsafe impl Send/Sync` (lines 8–22 at
  [`cb91e86`](https://github.com/nglmercer/tray-icon-node/blob/cb91e86184ed8612bcdee904277b4d5e78d966c3/src/menu.rs#L8-L22)).
- The same justification is repeated in the 0.1.1 changelog ("implement Send+Sync for menu items").
- `Menu.registry` / `Submenu.registry` are `Arc<Mutex<HashMap<String, AnyMenuItem>>>`, so the
  impls are what makes that container itself `Send + Sync`.

Dependency versions at the analyzed revision: `tray-icon 0.21.3`, `muda 0.17.2`,
`gtk 0.18.2`, `napi 3.15.0`.

## Why `Send`/`Sync` cannot be sound for these types

### 1. The handles are `Rc<RefCell<MenuChild>>`, not reference-counted OS handles

In `muda 0.17.2` each public menu-item handle is:

```rust
#[derive(Clone)]
pub struct MenuItem {
    pub(crate) id: Rc<MenuId>,
    pub(crate) inner: Rc<RefCell<crate::platform_impl::MenuChild>>,
}
```

The same shape is used by `CheckMenuItem`, `IconMenuItem`, `PredefinedMenuItem` and `Submenu`
(`muda/src/items/*.rs`). `Rc` uses a **non-atomic** refcount. Cloning or dropping an `Rc` from
two threads races on that refcount and can corrupt it, leading to use-after-free or double free.
The SAFETY comment's "reference-counted ... safe to move between threads" is exactly backwards:
`Rc` is the canonical single-thread refcount.

The `Menu` type used by `TrayIcon` has the same shape (`Rc<RefCell<platform_impl::Menu>>`), and
`tray-icon::TrayIcon` is `Rc<RefCell<platform_impl::TrayIcon>>` with no `Send`/`Sync` impl.
`tray-icon`'s own docs require the tray (and therefore its menu) to be created on the thread that
runs the event loop, and on macOS on the main thread.

### 2. Mutation happens through `&self` on a `RefCell`

The public handle methods need only a shared reference:

```rust
pub fn set_text<S: AsRef<str>>(&self, text: S) {
    self.inner.borrow_mut().set_text(text.as_ref())
}

pub fn set_checked(&self, checked: bool) {
    self.inner.borrow_mut().set_checked(checked)
}
```

`RefCell`'s borrow flag is a non-atomic `Cell<isize>`. If two threads call `set_text` /
`set_checked` through a `&AnyMenuItem`, both can observe a successful `borrow_mut()` and hold
`&mut MenuChild` aliases at the same time — immediate aliasing UB, independent of the platform.
This is also why `unsafe impl Sync` is unsound on its own: mutation does not require `&mut self`,
so a shared `&AnyMenuItem` is not read-only.

### 3. The contained platform objects are thread-affine

`platform_impl::MenuChild` owns GUI objects that are explicitly single-thread:

- **Linux:** `gtk::MenuItem`, `gtk::Menu`, `gtk::AccelGroup` (`gtk`/`glib` types are `!Send` and
  `!Sync`); `Drop` calls `unsafe { item.destroy() }` and touches the GTK containers.
- **macOS:** `Retained<NSMenuItem>` / `Retained<NSMenu>` from `objc2`; AppKit objects must be
  used on the main thread, and `Drop` releases them.
- **Windows:** raw `HMENU` handles; the owning `MenuChild` `Drop` calls `DestroyMenu` and mutates
  accelerator stores that are shared through `Rc<RefCell<..>>`.

Because the wrapper hides `!Send`/`!Sync`, the compiler can no longer prevent any of these from
happening on a worker thread. Even a "read-only" call such as `is_checked()` is not safe:
on Windows it enters `GetMenuItemInfoW`, and on Linux/macOS it goes through
`Rc<RefCell<MenuChild>>`/`Retained<NSMenuItem>` state.

### 4. The `Mutex` in `Menu` does not protect the item

The comment says "mutable access is protected by the `Mutex` in `Menu`". The `Mutex` only guards
the `HashMap` lookup/insertion in the registry; the actual mutation is the `RefCell::borrow_mut()`
inside `muda`, which is outside that lock. A `Mutex<HashMap<..>>` cannot make an `Rc<RefCell<..>>`
inside its values thread-safe, and it cannot make `!Send` values `Send`: `Mutex<T>: Send`
requires `T: Send`, which is precisely what is being asserted without proof.

## Reachability

- Today the crate is effectively single-threaded for menu work: `Menu` / `Submenu` are created,
  mutated and dropped on the JS thread that calls the N-API methods; `poll_menu_events()` and
  `update()` run on the same thread; the only `std::thread` usage is in `lib.rs` for the desktop
  notification bridge, which moves owned `String`s only and never touches a menu handle.
- So there is no known exploitable path from JavaScript today. (N-API class instances are also
  tied to one `napi_env`; they are not transferable between worker environments.)
- The impls are still a soundness defect: `unsafe impl` is a promise that *all* safe uses are
  sound. Safe code added later inside this crate (a `thread::spawn`, a `tokio::spawn`, an async
  N-API method, an `AsyncTask`, or sharing the registry with a worker) would compile and invoke
  UB. The crate enables the `napi` `"async"` feature (and previously depended on `tokio` with
  `features = ["full"]`), so that direction is not unrealistic.
- Additional consistency problem: even with the impls, `Menu` and `Submenu` remain `!Send`/
  `!Sync` because their `inner: tray_menu::Menu` / `tray_menu::Submenu` fields are `!Send`.
  The impls only affect the registry container (`Arc<Mutex<HashMap<..>>>`), so they do not make
  the public half of the type thread-safe either. They buy nothing and cost the compiler guard.

## Minimal repro

The UB class can be shown without any GUI code by reproducing the wrapper shape with `Rc<RefCell<_>>`
and Miri (`cargo +nightly miri run`):

```rust
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

struct Wrapper(Rc<RefCell<u32>>);
unsafe impl Send for Wrapper {} // identical claim to AnyMenuItem
unsafe impl Sync for Wrapper {}

fn main() {
    let shared = Arc::new(Wrapper(Rc::new(RefCell::new(0))));
    std::thread::scope(|s| {
        for _ in 0..2 {
            let shared = Arc::clone(&shared);
            s.spawn(move || {
                // `&self` mutation, like set_text/set_checked
                *shared.0.borrow_mut() += 1;
            });
        }
    });
}
```

Expected result: Miri reports a data race / aliasing mutable borrow (and the `Rc` refcount
increments are themselves a race). Removing the two impls makes the snippet fail to compile,
which is the point.

Crate-level illustration (would compile today *only* because of the impls; it is not in the tree):

```rust
let menu = Menu::new();
let registry = menu.registry.clone(); // Arc<Mutex<HashMap<String, AnyMenuItem>>>
std::thread::spawn(move || {
    let reg = lock_registry(&registry);
    if let Some(AnyMenuItem::Standard(item)) = reg.get("action") {
        item.set_text("from worker"); // RefCell/GTK/AppKit call off the owning thread
    }
});
```

A reliable real-hardware demonstration is not practical because the failure mode is
platform/UI dependent; the type-level argument and the reduced Miri repro are sufficient.

## Suggested fix

**Preferred (minimal, correct): remove the `unsafe impl Send` / `unsafe impl Sync` lines.**

- Menu handles in `tray-icon`/`muda` are intentionally single-thread. The crate should keep them
  that way. If a compile error appears after removal, that error is the design constraint being
  surfaced, not a reason to re-add the impl.
- Keep the registry single-threaded too: use `Rc<RefCell<HashMap<String, AnyMenuItem>>>` (or a
  plain `Mutex` with no `Arc`, used only on the owning thread) rather than making the map
  `Send`/`Sync` by assertion.
- Replace the SAFETY comment: `tray-icon` does **not** guarantee `Send + Sync`; it requires
  creation/use on the event-loop thread.
- Drop the unused `napi` `"async"` feature if no async N-API function exists, so handles are not
  inadvertently allowed to cross into libuv/tokio worker threads.

**If cross-thread menu control is a real requirement**, do not move the handles. Move commands:

```rust
enum MenuCommand {
    Append { id: MenuId, spec: ItemSpec },
    SetText { id: MenuId, text: String },
    SetChecked { id: MenuId, checked: bool },
    Toggle { id: MenuId, reply: std::sync::mpsc::Sender<bool> },
}

// Send + Sync because it owns only Strings/ids/channels.
#[derive(Clone)]
struct MenuHandle { tx: std::sync::mpsc::Sender<MenuCommand> }
```

A single owning thread (the one running the GTK/Win32/AppKit loop) drains the channel and calls
`muda`. Replies go back through `std::sync::mpsc` or `tokio::sync::oneshot`. `Menu` and
`AnyMenuItem` stay `!Send`, and no `unsafe` is needed.

**Do not** "fix" this with `Mutex<AnyMenuItem>` or `Arc<Mutex<..>>` around the wrapper while
keeping the impls: a `Mutex` does not make `!Send` values movable across threads, does not
synchronize the inner `RefCell`, and does not make GTK/AppKit calls legal off the owning thread.

## Environment

- `tray-icon-node` 0.1.2 (`cb91e86184ed8612bcdee904277b4d5e78d966c3`)
- `tray-icon` 0.21.3, `muda` 0.17.2, `gtk` 0.18.2 / `glib` 0.18.5, `objc2` 0.6.5,
  `objc2-app-kit` 0.3.2, `napi` 3.15.0
- Platforms affected: all three (the `Rc`/`RefCell` argument is platform-independent; the
  thread-affinity argument differs per platform as described above).

## Filing checklist (internal)

- [ ] File as an issue on `nglmercer/tray-icon-node` at the next upstream sync.
- [ ] Link back to the analyzed commit in the body (already included).
- [ ] If the upstream maintainer accepts removal, update `for-os/native/tray-icon-node/src/menu.rs`
      in the same commit that bumps the upstream pin, then run
      `npm run for-os:integrity:record` and rebuild the addon.
- [ ] Do not file or comment on the upstream repository from the decaf-ts workspace without the
      SAA-1658 Git Commit Gate / board approval.
