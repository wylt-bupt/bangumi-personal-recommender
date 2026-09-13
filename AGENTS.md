# Project delivery workflow

Unless the user explicitly asks for a local-only draft, do not treat a product change as complete until the full delivery flow is finished:

1. Implement the requested source and test changes.
2. Run the relevant unit and browser-level verification.
3. Bump every affected release version in `package.json` and update `README.md` release notes.
4. Rebuild and verify the matching files under `dist/`.
5. Commit the source, tests, documentation, versions, and generated release artifacts.
6. Push the current branch to its configured Git remote.
7. Publish the affected Bangumi component version and verify the live version/page behavior:
   - App `6931`: `dist/bangumi-personal-recommender.user.js` (the `.bgm.txt` file is an identical paste-friendly copy).
   - App `7057`: `dist/bangumi-personal-timeline.user.js`.

If authentication, permissions, network state, review policy, or a required confirmation prevents publishing, report the exact blocker and the last completed delivery step. Never imply that a local build or Git commit is already live on Bangumi.
