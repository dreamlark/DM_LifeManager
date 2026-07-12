import type { Config } from 'tailwindcss';

// 所有主题色都改成「RGB 通道变量 + <alpha-value>」形式，
// 这样既能随 .dark / :root 翻转，又能正确套用 Tailwind 的透明度修饰（如 bg-bg-panel/50、border-gray-500/40）。
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: v('--bg-base'),
          panel: v('--bg-panel'),
          raised: v('--bg-raised'),
          border: v('--bg-border'),
          // 半透明叠加层（hover 等），直接用完整 rgba 变量，不套 alpha
          soft: 'var(--bg-soft)',
        },
        accent: v('--accent'),
        gray: {
          100: v('--gray-100'),
          200: v('--gray-200'),
          300: v('--gray-300'),
          400: v('--gray-400'),
          500: v('--gray-500'),
          600: v('--gray-600'),
          700: v('--gray-700'),
          800: v('--gray-800'),
          900: v('--gray-900'),
        },
      },
      fontFamily: {
        sans: ['"Inter"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
