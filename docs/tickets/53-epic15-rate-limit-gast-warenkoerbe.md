## Hintergrund

Aus #203 (PR #208) zurückgestellt: Das Anlegen neuer Gast-Warenkörbe (`addToCartAction`) hat kein Rate-Limit pro IP. Die erlaubten Scopes von `auth_rate_limit_attempts` sind per CHECK-Constraint begrenzt; ein eigener Scope braucht eine Migration. Die Mitbenutzung eines bestehenden Scopes (z. B. `checkout`) würde dessen Limits verfälschen.

## Akzeptanzkriterien

- [ ] Migration erweitert den Scope-Constraint um einen neuen Scope (z. B. `cart`)
- [ ] `addToCartAction` begrenzt neue Warenkörbe großzügig pro IP (z. B. 60/Stunde) über `lib/auth/rate-limit.ts`
- [ ] Tests (Limit greift, bestehende Warenkörbe unberührt)
