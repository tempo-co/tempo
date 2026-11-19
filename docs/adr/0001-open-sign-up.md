# Open sign-up

Tempo is built for anyone at any bank and in any country Enable Banking covers, so sign-up is open: `POST /auth/signup` is public, and there is no invite list or sign-up switch in the API configuration. Each account sees only its own data, which is why every account-owned query is scoped to the user's account id. Proposals to close sign-up or add an invite gate reopen this decision.
