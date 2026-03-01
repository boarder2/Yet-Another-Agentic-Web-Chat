# Theming

YAAWC supports three theme modes: Light, Dark, and Custom. The theme system uses CSS custom properties applied to the `<html>` element, ensuring all components respond to theme changes instantly.

---

## Theme Modes

### Light

Standard light theme. The `<html>` element does not have the `dark` class. All Tailwind CSS custom properties use their light-mode values from the stylesheet.

### Dark (Default)

Standard dark theme. The `<html>` element has the `dark` class. All Tailwind CSS custom properties use their dark-mode values from the stylesheet. This is the default theme for new users.

### Custom

User-defined color scheme with two configurable values:

| Input                | Effect                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Background color** | Sets `--color-bg`. Foreground (`--color-fg`), surface, and surface-2 colors are automatically derived               |
| **Accent color**     | Sets `--color-accent`. Lighter (500) and darker (700) variants are auto-derived. Also maps to blue-\* CSS variables |

#### Automatic Color Derivation

When a custom background is set:

1. **Luminance** is calculated from the background color.
2. **Foreground** is set to black (`#000000`) for light backgrounds (luminance > 0.5) or white (`#ffffff`) for dark backgrounds.
3. **Surface** is slightly lighter/darker than the background (offset by +0.08 for dark, -0.06 for light).
4. **Surface-2** is more noticeably different from the background (offset by +0.12 for dark, -0.10 for light).
5. The `dark` CSS class is added when luminance <= 0.5, removed otherwise. This ensures Tailwind dark-mode utilities respond correctly.

When a custom accent is set:

1. The base accent is normalized to a hex color.
2. A darker variant (700) is produced by reducing lightness by 0.10.
3. A lighter variant (500) is produced by increasing lightness by 0.10.
4. A very light variant (50) and very dark variant (900) are produced for edge-case uses.
5. All blue-\* CSS variables are remapped to the accent variants, so existing Tailwind blue utilities adopt the custom accent.

---

## Theme Selection UI

Located in the Settings page under "Preferences":

- A `<select>` dropdown with options: Light, Dark, Custom.
- When **Custom** is selected, two native `<input type="color">` pickers appear inline:
  - **Background** color picker
  - **Accent** color picker
- Changes apply immediately (live preview as colors are adjusted).

---

## Persistence

| localStorage Key | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `appTheme`       | `"light"`, `"dark"`, or `"custom"`                                       |
| `userBg`         | Hex color string (e.g., `"#0f0f0f"`), only used when theme is `"custom"` |
| `userAccent`     | Hex color string (e.g., `"#2563eb"`), only used when theme is `"custom"` |

The theme is applied on mount by `ThemeController`, which reads these values from localStorage and applies them before rendering any children. Until the theme has been applied, the component renders nothing (prevents flash of unstyled content).

---

## Implementation Architecture

### ThemeController (Root Level)

Wraps the entire application. On mount:

1. Reads the saved theme, background, and accent from localStorage.
2. Applies the theme by setting `data-theme` attribute and CSS custom properties on `<html>`.
3. Exposes a `window.__setAppTheme(mode, bg, accent)` function for the ThemeSwitcher to call.

### ThemeSwitcher (Settings Page)

A controlled component that:

1. Reads the current theme from localStorage on mount.
2. Renders the dropdown and optional color pickers.
3. On change, calls `window.__setAppTheme(mode, bg, accent)` which persists and applies the theme.

### ThemeProvider (next-themes)

Wraps the app with `next-themes` ThemeProvider. System theme detection is disabled; the default is dark.

---

## CSS Custom Properties Used

| Property                                                         | Purpose                               |
| ---------------------------------------------------------------- | ------------------------------------- |
| `--color-bg`                                                     | Page background                       |
| `--color-fg`                                                     | Text foreground                       |
| `--color-surface`                                                | Card and container backgrounds        |
| `--color-surface-2`                                              | Elevated surface backgrounds, borders |
| `--color-accent`                                                 | Primary interactive color             |
| `--color-accent-500`, `--color-accent-600`, `--color-accent-700` | Accent shades                         |
| `--color-blue-50` through `--color-blue-900`                     | Remapped to accent in custom mode     |

When switching to Light or Dark mode, all inline custom property overrides are cleared so the stylesheet defaults take effect.

---

## Code Syntax Highlighting

The `MarkdownRenderer` detects the current theme mode by checking the `<html>` element's class list for `dark`:

- **Dark mode**: Uses `oneLight`-compatible dark Prism theme.
- **Light mode**: Uses a `oneLight` Prism theme.

This detection is performed at render time, so code blocks always match the current theme.
