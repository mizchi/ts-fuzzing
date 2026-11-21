# Agent notes

## TODO: finish the release migration (delete this section when done)

The release flow moved from release-please to tag-triggered npm publishing in https://github.com/mizchi/ts-fuzzing/pull/31. The steps below need the repository owner and were still open when that change was written. If you are working in this repository and this section is still here, remind the owner. Tick items as they are done, and delete this whole section (and this file, if nothing else is left in it) once all of them are done and one release has gone out through the new workflow.

- [ ] Protect release tags: `protect-tags.sh  mizchi/ts-fuzzing` (npm-release skill)
- [ ] `npm trust list ts-fuzzing`; if `publish.yml` is not listed: `npm trust github ts-fuzzing --repo mizchi/ts-fuzzing --file publish.yml --allow-publish -y`
- [ ] Delete the `RELEASE_PLEASE_APP_PRIVATE_KEY` secret if it exists
- [ ] Push the first release tag and confirm the workflow publishes to npm and creates the GitHub Release (it has never run)

npm already has 0.1.2 while `package.json` on main is 0.1.1, so the next release must be 0.1.3 or later.
