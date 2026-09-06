"use client";

import { useEffect, useState } from "react";

interface CategoryNavItem {
  id: string;
  name: string;
}

interface CategoryNavProps {
  categories: CategoryNavItem[];
}

/**
 * Horizontal tab-style category navigation (design pass v2, see
 * `packages/ui/src/tokens.ts`'s header comment). Isolated as a client
 * component so the surrounding public menu page (`page.tsx`) stays a Server
 * Component (`.claude/rules/frontend.md`: "public menu pages are
 * server-rendered") -- the only client-side behavior needed is scroll-spy
 * highlighting of the currently visible category section via
 * `IntersectionObserver`.
 *
 * The anchor links themselves (`href="#category-{id}"`) work with
 * JavaScript disabled -- scroll-spy is a progressive enhancement on top of
 * real navigation, not a replacement for it.
 */
export function CategoryNav({ categories }: CategoryNavProps) {
  const [activeId, setActiveId] = useState<string>(categories[0]?.id ?? "");

  useEffect(() => {
    if (categories.length === 0) {
      return;
    }

    const sections = categories
      .map((category) => document.getElementById(`category-${category.id}`))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) {
          return;
        }
        const topmost = visible.reduce((closest, entry) =>
          entry.boundingClientRect.top < closest.boundingClientRect.top ? entry : closest,
        );
        setActiveId(topmost.target.id.replace("category-", ""));
      },
      // Top offset accounts for this nav's own sticky height; the generous
      // bottom margin means a section only "wins" once it occupies the
      // upper portion of the viewport, avoiding flicker between adjacent
      // short sections.
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, [categories]);

  return (
    <nav
      aria-label="Kategorien"
      className="sticky top-0 z-10 border-b border-neutral-200 bg-surface/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl gap-8 overflow-x-auto px-5 sm:px-8">
        {categories.map((category) => {
          const isActive = category.id === activeId;
          return (
            <a
              key={category.id}
              href={`#category-${category.id}`}
              aria-current={isActive ? "true" : undefined}
              className={`shrink-0 border-b-2 py-4 text-sm font-medium motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600 ${
                isActive
                  ? "border-ember-600 text-ember-600"
                  : "border-transparent text-foreground-secondary hover:text-foreground"
              }`}
            >
              {category.name}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
