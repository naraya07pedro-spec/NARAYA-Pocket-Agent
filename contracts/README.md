# API contracts

The pilot's machine-readable API is defined by handlers in `worker/src/index.ts` and the request validation in `worker/src/domain.ts`. Future P1 will introduce a versioned schema and Android generated clients. Do not ship the pilot owner bearer secret in any client. See `../README.md` for current endpoints.
