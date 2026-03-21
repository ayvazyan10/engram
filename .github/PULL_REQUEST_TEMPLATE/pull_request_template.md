## Summary

<!-- What does this PR do? Link the issue it closes if applicable: Closes #123 -->

## Changes

<!-- Bullet points of what changed -->

## Testing

<!-- How did you test this? What commands should a reviewer run? -->

```bash
pnpm turbo run build
pnpm turbo run test
```

## Checklist

- [ ] `pnpm turbo run build` passes
- [ ] `pnpm turbo run test` passes
- [ ] New functionality has tests
- [ ] DB schema changes use `drizzle-kit generate` + `migrate` (never `push`)
- [ ] Docs updated if public behavior changed
