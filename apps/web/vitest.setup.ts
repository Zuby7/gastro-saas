import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest doesn't run in "globals" mode in this repo (see vitest.config.mts),
// so @testing-library/react's automatic per-test DOM cleanup (which only
// self-registers via a global `afterEach`) never fires on its own -- without
// this, multiple `render()` calls across tests in the same file (or across
// files sharing a jsdom document) leak previous renders into the DOM and
// break `getByRole`/`getByText` queries that expect a single match.
afterEach(cleanup);
