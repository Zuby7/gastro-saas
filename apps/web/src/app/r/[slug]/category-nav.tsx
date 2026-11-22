"use client";

import { useEffect, useRef, useState } from "react";

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
  // While a click-initiated smooth scroll is running, scroll-spy must not
  // override the clicked tab with the sections passed on the way.
  const lockedUntilRef = useRef(0);

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

    const lastCategoryId = categories[categories.length - 1]?.id;

    // Page bottom: the last category can be too short to ever reach the
    // observer's upper band, so it would never win. At the very bottom of
    // the page the last category is the active one.
    const onScroll = () => {
      if (Date.now() < lockedUntilRef.current || !lastCategoryId) {
        return;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && window.scrollY > 0) {
        setActiveId(lastCategoryId);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lockedUntilRef.current) {
          return;
        }
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

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
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
              onClick={() => {
                setActiveId(category.id);
                lockedUntilRef.current = Date.now() + 1000;
              }}
              className={`flex min-h-11 shrink-0 items-center border-b-2 py-4 text-sm font-medium motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600 ${
                isActive
                  ? "border-accent-foreground text-accent-foreground"
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
