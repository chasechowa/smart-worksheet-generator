/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './components/TestPreview.tsx',
  ],
  // Important: do NOT include preflight (base reset) to avoid conflicting
  // with BASE_STYLES which already handles body/typography for print
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      // Support the custom font-size values used in the component
      fontSize: {
        '11pt': '11pt',
        '9pt': '9pt',
      },
      // Support leading-[2.5rem]
      lineHeight: {
        '2.5rem': '2.5rem',
      },
    },
  },
};
