# Ticket Backlog

These files are the local mirror of the real ticket backlog, which lives as GitHub Issues in [Zuby7/gastro-saas](https://github.com/Zuby7/gastro-saas/issues) (Milestones = Epics, Project board = [gastro-saas Roadmap](https://github.com/users/Zuby7/projects/1)).

GitHub Issues are the source of truth for ticket status (use the "Workflow Status" field on the project board: Backlog → Ready → In Progress → In Review → Changes Requested → Blocked → Done). These local `.md` files are the content record used to generate the issues and a fallback if GitHub is unavailable — if a ticket's scope changes, update the GitHub Issue and re-sync this file, not the other way around.

Numbering matches issue creation order, not necessarily execution order — check ticket dependencies before starting one.

## Epic-Übersicht

Stand 2026-10-09. Jedes Epic = Milestone = Parent-Issue (GitHub Sub-Issues). Folgearbeiten und Bugfixes hängen unter dem Epic des Tickets, dem sie folgen.

| Epic | Milestone | Parent-Issue | Kinder (Issues) |
| --- | --- | --- | --- |
| 1 Repository & Engineering Foundation | 1 | #173 | #1 #2 #3 |
| 2 Architektur & Datenfundament | 2 | #174 | #4 #5 #6 |
| 3 Auth & Autorisierung | 3 | #175 | #7 #8 #9 #10 #60 #61 #62 #71 #114 |
| 4 Restaurant-Profil & Menü-Verwaltung | 4 | #176 | #11 #12 #13 #14 #15 #68 #69 #70 #72 |
| 5 Öffentliche Speisekarte | 5 | #177 | #16 #17 #18 #19 #84 #152 |
| 6 Warenkorb & Bestellung | 6 | #178 | #20 #21 #22 #96 #153 |
| 7 Zahlungen | 7 | #179 | #23 #24 #25 #26 #40 #88 #90 #91 #92 #93 #94 #95 #97 |
| 8 Bestell-Betrieb | 8 | #180 | #27 #28 #29 |
| 9 Analytics | 9 | #181 | #30 #31 #32 #58 #59 #67 #120 |
| 10 Bewertungen & Qualität | 10 | #182 | #33 #34 #121 |
| 11 Betrieb & Härtung | 11 | #183 | #35 #37 #89 |
| 12 Integrationsfundament | 12 | #184 | #38 #39 |
| 13 Compliance & Datenschutz | 13 | #146 | #36 #41 #123 #162 #163 #164 #166 |
| 14 Betrieb & Deployment (Cloudflare/Stripe-Testmodus) | 14 | #185 | #157 |
| 15 Qualität, Tests & Barrierefreiheit | 15 | #186 | #76 #83 #159 |

Hinweis: #164 (Code gemergt in PR #169) bleibt offen, bis das pg_cron-SQL manuell in der gehosteten DB ausgeführt wurde (`status:blocked-on-external`). Project-Board-Status (Workflow Status) ist noch nicht gesetzt, siehe Backlog-Bereinigung.
