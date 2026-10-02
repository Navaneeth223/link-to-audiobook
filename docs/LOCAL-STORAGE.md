# Local storage and cookies

The reader uses localStorage for preferences and locators, and OPFS (origin-private file system) for the optional downloadable Piper voice and audiobook export data. It does not use analytics or advertising trackers. Generated audio and resumable data stay within this browser origin.

| Key pattern                     | Stored value                                                  | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `psr-position-*`                | Chapter and paragraph indices                                 | Restore a reading position for the same filename and extracted text length           |
| `psr-bookmarks-*`               | Bookmark labels and document locators                         | Restore bookmarks without storing story text                                         |
| `psr-volume-preferences`        | Volume, mute, and last non-zero volume                        | Restore app playback volume                                                          |
| `psr-audiobook-exports/` (OPFS) | Active/resumable manifests, temporary chapter audio, and progress | Resume an interrupted export and provide output while its finished dialog is open; removed on Done/Close/Delete |
| `psr-audio-cache/` (OPFS)       | Encoded mono PCM chunks keyed by a one-way digest                    | Reuse audio while resuming or exporting another format; unshared cache removed on Done/Close/Delete |
| `piper/` (OPFS)                 | Downloaded LibriTTS voice model and configuration             | Run the in-browser downloadable speech provider without repeated model downloads     |

The optional Microsoft sign-in flow uses an HTTP-only `psr.sid` session cookie with `SameSite=Lax`; in production it is marked Secure. The current API session expires after one hour. The app's current **Forget this story** action clears only that story's position and bookmarks, not volume settings, audiobook data, or the Microsoft session. The device-data viewer supports deleting resumable exports and the downloaded voice, as well as **Clear cached audio** (export files, manifests, and PCM cache; the voice remains). **Clear everything** removes app-owned localStorage keys, app-prefixed cache/database entries, and the three OPFS directories above, then requests server session logout and reports the observed result. Browser quotas are implementation-dependent; deletion can fail if a browser refuses access or a page holds a file open. Use browser site-data controls if app-level removal is unsuccessful.
