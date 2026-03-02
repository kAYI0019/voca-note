/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mist: {
          50: '#f8fcff',
          100: '#eef6ff',
          200: '#ddeeff',
        },
      },
      boxShadow: {
        card: '0 20px 35px -20px rgba(56, 120, 178, 0.22)',
      },
    },
  },
  plugins: [],
}
