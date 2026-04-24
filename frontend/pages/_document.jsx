import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta name="description" content="Ascend - Deployment Management System" />
        <link rel="icon" type="image/png" href="/logo/favicon.png" />
        <link rel="apple-touch-icon" href="/logo/favicon.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
