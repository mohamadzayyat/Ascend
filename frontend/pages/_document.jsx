import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="description" content="Ascend - Deployment Management System" />
        <link rel="icon" type="image/svg+xml" href="/logo/ascend-mark.svg" />
        <link rel="apple-touch-icon" href="/logo/favicon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ascend-theme')||'midnight';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
