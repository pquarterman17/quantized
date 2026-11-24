// Reach a menu item that lives inside one or more flyouts (UX10-B/C grouped the
// menubar and the Library row menus into submenus). Hovers each submenu in
// turn, then clicks the final item. The leaf is matched exactly; pass the full
// visible label.
import type { Page } from "@playwright/test";

export async function clickMenuPath(page: Page, ...path: [string, ...string[]]): Promise<void> {
  const leaf = path[path.length - 1];
  for (const submenu of path.slice(0, -1)) {
    await page.getByRole("menuitem", { name: submenu, exact: true }).hover();
  }
  await page.getByRole("menuitem", { name: leaf, exact: true }).click();
}
