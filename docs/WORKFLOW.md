# How we work together

## One-time setup (Renata)

1. Create a **private GitHub repo** called `fairfare` and push this folder:
   ```bash
   git init && git add . && git commit -m "Starter: contract, mocks, roles"
   git branch -M main
   git remote add origin https://github.com/<you>/fairfare.git
   git push -u origin main
   ```
2. Repo **Settings → Collaborators**: invite both friends.
3. Open `.github/CODEOWNERS` and replace `@DATA_FRIEND_GITHUB` and `@VOICE_FRIEND_GITHUB` with their usernames. Commit.
4. **Settings → Branches → Add rule** for `main`:
   - ✅ Require a pull request before merging (1 approval)
   - ✅ Require review from Code Owners
   - ✅ Require status checks to pass → pick **check**
5. Share API keys privately (not in the repo, not in group chat history if you can avoid it). Each person pastes them into their own `.env`.

## Every time you work

```bash
git checkout main && git pull          # get everyone's latest work
git checkout -b voice/elevenlabs-tts   # new branch: <role>/<what>
# ...work with Claude Code...
npm run check                          # must pass
git add . && git commit -m "Voice: real text-to-speech with ElevenLabs"
git push -u origin voice/elevenlabs-tts
```
Then open a **pull request** on GitHub. Someone reviews, the checks go green, then merge.

Branch names: `ui/...`, `data/...`, `voice/...`, `contract/...`

## Keep merges small

- Merge at least **twice a day** during the hackathon. Small pull requests rarely conflict.
- Pull `main` before you start anything new.
- If you get a merge conflict in someone else's folder, stop and ask them.

## Using Claude Code together

- Everyone opens the repo in VS Code. Claude Code reads `CLAUDE.md` automatically.
- Start each session by telling it your role: *"I'm the Data role."* It will stay in your folder.
- Ask it to run `npm run check` before you commit.
- Pairing live? Use the **Live Share** extension (it's in the recommended extensions).

## Demo-day safety

- The night before: everyone pulls `main`, runs `npm install`, `npm run dev`, and does the full demo once.
- If the internet or a key fails during the demo, set `DATA_MODE=mock VOICE_MODE=mock AI_MODE=mock` in `.env` and restart. The demo still works.
- Even with real modes on, voice and AI fall back to mocks automatically if they error.
