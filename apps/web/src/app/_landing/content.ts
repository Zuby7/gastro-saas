/**
 * Copy for the marketing landing page (issue #196). Single place for the
 * product name so the brand can be renamed in one edit. No invented facts:
 * no prices, customer logos, testimonials, statistics or contact data.
 */
export const BRAND_NAME = "Gastro-SaaS";

export const DEMO_HREF = "/r/trattoria-da-mario";
export const REGISTER_HREF = "/register";
export const LOGIN_HREF = "/login";

export const CHALLENGES = [
  {
    title: "Papierkarten veralten",
    description:
      "Ein neuer Preis oder ein ausverkauftes Gericht heißt neu drucken oder durchstreichen.",
  },
  {
    title: "Wartezeit am Tisch",
    description:
      "Gäste warten auf Karte, Bedienung und Rechnung. Das kostet Zeit auf beiden Seiten.",
  },
  {
    title: "Zahlen im Blindflug",
    description:
      "Ohne Auswertung bleibt offen, welche Gerichte laufen und wann Ihr Haus wirklich voll ist.",
  },
] as const;

export const FEATURES = [
  {
    eyebrow: "Speisekarte",
    title: "QR-Code am Tisch",
    description:
      "Gäste scannen den Code und sehen Ihre Karte im Browser. Ohne App, immer mit aktuellen Preisen.",
    image: "feature-menu.webp",
    alt: "Smartphone-Ansicht einer digitalen Speisekarte mit Kategorien und Gerichten",
    width: 390,
    height: 520,
  },
  {
    eyebrow: "Bestellung",
    title: "Direkt im Dashboard",
    description:
      "Jede Bestellung erscheint sofort im Restaurant-Dashboard und wandert von Neu bis Abgeschlossen.",
    image: "feature-orders.webp",
    alt: "Bestell-Dashboard mit Spalten für neue, angenommene und fertige Bestellungen",
    width: 390,
    height: 520,
  },
  {
    eyebrow: "Zahlung",
    title: "Online bezahlen",
    description:
      "Der Server berechnet den Betrag neu. Eine Bestellung gilt erst als bezahlt, wenn Stripe es bestätigt.",
    image: "feature-checkout.webp",
    alt: "Smartphone-Ansicht der Kasse mit Bestellübersicht und Zahlungsauswahl",
    width: 390,
    height: 520,
  },
  {
    eyebrow: "Auswertung",
    title: "Zahlen statt Bauchgefühl",
    description: "Topseller, Umsatzverlauf und Stoßzeiten im Überblick, dazu Gästebewertungen.",
    image: "feature-analytics.webp",
    alt: "Analytics-Ansicht des Restaurant-Dashboards mit Kennzahlen und Verläufen",
    width: 390,
    height: 520,
  },
] as const;

export const PAYMENT_METHODS = ["Karte", "Apple Pay", "Klarna", "Link", "Bank"] as const;

export const STEPS = [
  {
    number: "01",
    title: "Registrieren",
    description: "Legen Sie Ihr Restaurant an. Das dauert nur wenige Minuten.",
  },
  {
    number: "02",
    title: "Speisekarte pflegen",
    description: "Gerichte, Preise und Kategorien selbst anlegen und jederzeit anpassen.",
  },
  {
    number: "03",
    title: "QR-Code aufstellen",
    description: "Gäste bestellen am Tisch, Ihr Team sieht jede Bestellung sofort.",
  },
] as const;

export const VALUES = [
  {
    title: "Datenschutz von Anfang an",
    description:
      "Einwilligungsverwaltung und Datenschutzhinweise sind Teil des Produkts. Das ersetzt keine Rechtsberatung.",
  },
  {
    title: "Barrierefrei gebaut",
    description:
      "Tastaturbedienung, sichtbarer Fokus und geprüfte Kontraste in hellem und dunklem Design.",
  },
  {
    title: "Bewertungen im Blick",
    description: "Gäste bewerten ihre Bestellung, Sie sehen das Feedback gesammelt im Dashboard.",
  },
  {
    title: "Mehrere Restaurants getrennt",
    description: "Jedes Restaurant arbeitet mit eigenen Daten, sauber von anderen getrennt.",
  },
] as const;

export const FAQS = [
  {
    question: "Brauchen meine Gäste eine App?",
    answer: "Nein. Gäste scannen den QR-Code und bestellen direkt im Browser ihres Smartphones.",
  },
  {
    question: "Wie bezahlen Gäste?",
    answer:
      "Online über Stripe, zum Beispiel mit Karte, Apple Pay, Klarna, Link oder per Bank. Welche Methoden angezeigt werden, hängt vom Gerät und vom Land ab.",
  },
  {
    question: "Ist das schon im Live-Betrieb?",
    answer:
      "Wir befinden uns in der Pilotphase. Zahlungen laufen derzeit im Testmodus, es werden keine echten Beträge abgebucht.",
  },
  {
    question: "Was kostet das?",
    answer:
      "Verbindliche Preise gibt es in der Pilotphase noch nicht. Sobald sie feststehen, veröffentlichen wir sie hier.",
  },
  {
    question: "Wie sieht es mit Datenschutz aus?",
    answer:
      "Datenschutz ist eingebaut, zum Beispiel mit einem Cookie-Hinweis und Einwilligungsverwaltung. Details finden Sie in der Datenschutzerklärung.",
  },
  {
    question: "Kann ich es vorher ausprobieren?",
    answer:
      "Ja. In der Live-Demo können Sie die Speisekarte eines Beispielrestaurants ansehen und eine Testbestellung aufgeben.",
  },
] as const;
