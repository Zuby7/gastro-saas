Befund aus dem Opus-Review zu #207 (gleiche Fehlerklasse wie dort behoben):

- `webhook-service.ts`, `markOrderCancelledForPaymentFailure`: Ein Insert-Fehler auf `order_status_events` wird nur geloggt, die Funktion kehrt normal zurück, das Event gilt als verarbeitet. Auch der Fehler beim Update auf `payments` wird ignoriert.
- `maybeSingle()` mit mehreren Treffern wirft jetzt dauerhaft; Stripe versucht es erneut, bis der Endpunkt deaktiviert wird. Klären, ob `stripe_checkout_session_id` und `stripe_payment_intent_id` eindeutig (unique) sind.
- Registrierung: Das 500-ms-Zeitpolster kann kürzer sein als der Mailversand beim Neuanlegen; zwei Restkanäle (Zeit, Mail-Limit) im Threat-Model dokumentieren, Abschnitt "Enumeration" um die neutrale Registrierung ergänzen.
- Prüfen, ob Supabase `enable_confirmations` im gehosteten Projekt aktiv ist (sonst bleibt Enumeration möglich).

Akzeptanz: Fehler werfen statt schlucken, Tests, Doku.
