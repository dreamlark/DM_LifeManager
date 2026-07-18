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
        // Apple 系统字体栈优先（SF Pro / PingFang SC），其余回退
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'PingFang SC',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
      },
      // Apple 风格：更大的统一圆角，卡片/控件更圆润
      borderRadius: {
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '26px',
        card: '18px',
        btn: '10px',
      },
      // 柔和、低对比的投影，营造 Apple 卡片轻盈浮起感
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)',
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
    },
  },
  plugins: [],
} satisfies Config;
