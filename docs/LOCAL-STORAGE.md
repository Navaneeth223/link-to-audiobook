# Local storage and cookies

The reader uses localStorage for a small set of preferences and locators. It does not use analytics or advertising trackers and does not currently use IndexedDB or Cache Storage.

| Key pattern | Stored value | Purpose |
| --- | --- | --- |
| `psr-position-*` | Chapter and paragraph indices | Restore a reading position for the same filename and extracted text length |
| `psr-bookmarks-*` | Bookmark labels and document locators | Restore bookmarks without storing story text |
| `psr-volume-preferences` | Volume, mute, and last non-zero volume | Restore app playback volume |

The optional Microsoft sign-in flow uses an HTTP-only `psr.sid` session cookie with `SameSite=Lax`; in production it is marked Secure. The current API session expires after one hour. The app's current **Forget this story** action clears only that story's position and bookmarks, not volume settings or the Microsoft session. **Clear everything** removes app-owned localStorage keys and app-prefixed cache/database entries, then requests server session logout and reports whether the API confirmed it.
