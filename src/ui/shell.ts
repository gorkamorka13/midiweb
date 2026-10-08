// Habillage de la page : tiroir des réglages, menu, thème et icônes des boutons

import { version } from "../../package.json";

export type Theme = "system" | "light" | "dark";

/** Ce que le menu déclenche dans l'application. */
export interface ShellHandlers {
  open: () => void;
  exportMidi: () => void;
  saveCsv: () => void;
  loadExample: (index: number) => void;
  reset: () => void;
  /** Les couleurs affichées ont changé : les canevas sont à redessiner. */
  onTheme: () => void;
}

const THEME_KEY = "midiweb.theme"; // lue aussi par le script de index.html, avant le premier affichage

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const root = document.documentElement;
const panel = byId("panel");
const stage = byId("stage");
const menu = byId("menu");
const btnNav = byId<HTMLButtonElement>("btn-nav");
const btnMenu = byId<HTMLButtonElement>("btn-menu");
const wide = matchMedia("(min-width: 960px)"); // assez de place : les réglages restent à côté du lecteur

const dialogOpen = () => document.querySelector("dialog[open]") !== null;

let menuOpen = false;
let onTheme = (): void => {};

/** Change l'icône et le libellé d'un bouton. */
export function setButton(button: HTMLButtonElement, icon: string, label: string): void {
  button.querySelector("use")!.setAttribute("href", `#i-${icon}`);
  button.querySelector(".label")!.textContent = label;
}

/** Menu, tiroir ou message ouvert : les raccourcis clavier du lecteur sont suspendus. */
export function shellBusy(): boolean {
  return menuOpen || drawerOpen() || dialogOpen();
}

// --- Tiroir des réglages -----------------------------------------------------

const drawerOpen = () => document.body.classList.contains("nav-open");

/** Ouvert, le tiroir prend le focus et le lecteur derrière lui est hors d'atteinte. */
function setDrawer(open: boolean): void {
  const wasOpen = drawerOpen();
  document.body.classList.toggle("nav-open", open);
  btnNav.setAttribute("aria-expanded", String(open));
  btnNav.querySelector("use")!.setAttribute("href", open ? "#i-close" : "#i-menu");
  panel.inert = !open && !wide.matches;
  stage.inert = open;
  if (open) panel.focus();
  else if (wasOpen) btnNav.focus();
}

// --- Thème -------------------------------------------------------------------

/** Coche le thème choisi dans le menu et prévient l'application que les couleurs ont changé. */
function showTheme(): void {
  const theme = root.dataset.theme ?? "system";
  for (const item of menu.querySelectorAll<HTMLElement>('[data-action="theme"]')) {
    item.setAttribute("aria-checked", String(item.dataset.value === theme));
  }
  const surface = getComputedStyle(root).getPropertyValue("--surface").trim();
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = surface;
  onTheme();
}

/** Thème clair ou sombre, retenu pour la prochaine visite ; « system » suit le réglage de l'appareil. */
export function setTheme(theme: Theme): void {
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // stockage refusé (navigation privée, réglage du navigateur) : le thème n'est pas retenu
  }
  showTheme();
}

// --- Mise en place -----------------------------------------------------------

export function setupShell(handlers: ShellHandlers): void {
  onTheme = handlers.onTheme;

  btnNav.addEventListener("click", () => setDrawer(!drawerOpen()));
  byId("backdrop").addEventListener("click", () => setDrawer(false));
  wide.addEventListener("change", () => setDrawer(false));
  // Échap ferme d'abord le menu ou le message ouvert (c'est le navigateur qui s'en charge), puis le tiroir
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerOpen() && !menuOpen && !dialogOpen()) setDrawer(false);
  });
  setDrawer(false);

  const actions: Record<string, (item: HTMLElement) => void> = {
    open: handlers.open,
    export: handlers.exportMidi,
    "save-csv": handlers.saveCsv,
    example: (item) => handlers.loadExample(Number(item.dataset.index)),
    theme: (item) => setTheme(item.dataset.value as Theme),
    keys: () => byId<HTMLDialogElement>("dlg-keys").showModal(),
    about: () => byId<HTMLDialogElement>("dlg-about").showModal(),
    reset: handlers.reset,
  };
  menu.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!item) return;
    menu.hidePopover();
    actions[item.dataset.action!](item);
  });
  menu.addEventListener("toggle", (event) => {
    menuOpen = (event as ToggleEvent).newState === "open";
    btnMenu.setAttribute("aria-expanded", String(menuOpen));
    if (menuOpen) menu.querySelector<HTMLElement>("[data-action]")!.focus();
  });
  // Flèches, Début et Fin passent d'une entrée du menu à l'autre
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll<HTMLElement>("[data-action]")];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number | undefined> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[(next + items.length) % items.length].focus();
  });

  byId("about-version").textContent = version;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", showTheme);
  showTheme();
}
