/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#F3F4F6',
        surface: '#ffffff',
        'surface-gray': '#e5e7eb',
        accent: '#FF4208'
      }
    }
  },
  plugins: []
};

