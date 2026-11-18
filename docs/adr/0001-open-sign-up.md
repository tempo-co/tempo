# Open sign-up

Tempo is built for real users across any bank and country Enable Banking covers, not for a single owner, so anyone can create an account: `POST /auth/signup` is public, and there is no invite list or sign-up switch in the API configuration. Each account sees only its own data, which is why every account-owned query is scoped to the owner's account id. Proposals to close sign-up or add an invite gate reopen this decision.
