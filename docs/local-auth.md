# Local login

Use Node.js 24 or newer. In this worktree, run:

```powershell
npm.cmd run auth:setup -- demo-user
npm.cmd run dev -- -p 3004
```

Choose a password of at least 12 characters. The setup command prints a unique Base32 TOTP key once. Add it to an authenticator app as a time-based, six-digit, 30-second account. At `http://localhost:3004/login`, enter `demo-user`, your chosen password, and the current code. The server accepts the current code and one adjacent 30-second period to allow modest clock drift. Set your computer and phone clocks to automatic time if codes fail.

The command refuses to overwrite an existing account. It uses `CUSTODYOS_DATABASE_PATH` from the process environment or `.env.local`, falling back to `data/custodyos.sqlite`. Run it from this worktree and start Next.js from the same worktree. `demo-user` owns the bundled sample dashboard data; another username can sign in but starts with an empty workspace.

The password is requested in an interactive terminal without echoing. Keep the printed TOTP key private. This setup command is unavailable with `NODE_ENV=production` and does not add an account creation route.
