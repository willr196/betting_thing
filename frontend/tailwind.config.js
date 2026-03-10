/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef7f5',
          100: '#d7ebe7',
          200: '#b0d8cf',
          300: '#86c0b6',
          400: '#5ca99d',
          500: '#3f8d83',
          600: '#2f726a',
          700: '#285c56',
          800: '#244944',
          900: '#203d39',
        },
        accent: {
          50: '#fff5e8',
          100: '#ffe8c2',
          200: '#ffd18a',
          300: '#f9b85a',
          400: '#ee9834',
          500: '#dd7c1e',
          600: '#c76717',
          700: '#a14d16',
          800: '#823d19',
          900: '#6a3318',
        },
      },
    },
  },
  plugins: [],
}
