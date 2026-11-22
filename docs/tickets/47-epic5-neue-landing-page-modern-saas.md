## Ziel

Die Marketing-Startseite (`apps/web/src/app/page.tsx`) wird im Modern-SaaS-Stil neu gestaltet: Farbverläufe, weiche Glows, holografische Karten-Effekte, großes Produkt-Mockup, Screenshots als WebP.

## Akzeptanzkriterien

- [ ] Sektionen: Header, Hero, Herausforderung, Produkt-Showcase, 4 Feature-Spalten, Zahlarten-Chips, 3 Schritte, Wert-Karten, CTA-Band, FAQ (details/summary), Kontakt-CTA, Footer
- [ ] Nur Design-Tokens/CSS-Variablen (keine ad-hoc Hex-Farben), Dark-Scheme-Varianten
- [ ] Holo-Effekte (conic/linear Gradient), alle Animationen respektieren prefers-reduced-motion
- [ ] WCAG AA Kontrast in hellem und dunklem Schema, inkl. Verläufe (Tests)
- [ ] Eine h1, Skip-Link, sichtbarer Fokus, Bilder mit Alt-Text, dekorative Ebenen aria-hidden
- [ ] Bestehende Routen/Links funktionieren (/login, /register, /r/trattoria-da-mario)
- [ ] Ehrlicher Hinweis Pilotphase / Testmodus; keine erfundenen Kontaktdaten, Preise, Logos, Zitate, Zahlen; kein PayPal-Claim
- [ ] Assets in `apps/web/public/landing/`, Zuordnung in `docs/design/landing-assets.md`

## Nicht-Ziele

Keine Änderung an anderen Seiten, kein neues Branding, keine neuen Fonts.
