import type { CookieInventoryEntry } from "./inventory";

/** Shared cookie table (dialog + Datenschutz page) so both render the same inventory. */
export function CookieTable({
  cookies,
  caption,
}: {
  cookies: readonly CookieInventoryEntry[];
  caption: string;
}) {
  return (
    <div
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link-foreground"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="w-full border-collapse text-left text-sm text-foreground">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-neutral-300">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Name
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Zweck
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Dauer
            </th>
            <th scope="col" className="py-2 font-semibold">
              Anbieter
            </th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((cookie) => (
            <tr key={cookie.name} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-3 font-mono text-xs">{cookie.name}</td>
              <td className="py-2 pr-3">{cookie.purpose}</td>
              <td className="py-2 pr-3">{cookie.duration}</td>
              <td className="py-2">{cookie.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
