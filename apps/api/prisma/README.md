# ezRepo Prisma Schema

Prisma loads every `.prisma` file in this directory through `prisma.config.ts`.
Keep the generator and PostgreSQL datasource in `schema.prisma`. Place every
model and enum in its own kebab-case `.prisma` file named after the definition.

Every persisted ezRepo resource uses a UUID primary key named `id`. Models
that represent mutable resources also include `createdAt` and `updatedAt` UTC
timestamps. Provider run timestamps remain explicit so the source event time is
not confused with ezRepo's record timestamps.

Never edit `src/generated/prisma`; regenerate it through `pnpm db:generate`
after changing this schema.
