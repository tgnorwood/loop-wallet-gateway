import * as React from 'react'
import { emailTheme } from './theme'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head>
      <style>{darkModeCss}</style>
    </Head>
    <Preview>Your login link for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Click the button below to log in to {siteName}. This link will expire
          shortly.
        </Text>
        <Button className="dm-btn" style={button} href={confirmationUrl}>
          Log In
        </Button>
        <Text style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: emailTheme.body, fontFamily: emailTheme.font }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: emailTheme.ink,
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: emailTheme.muted,
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: emailTheme.signal,
  color: emailTheme.ink,
  fontSize: '14px',
  border: `1px solid ${emailTheme.signal}`,
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: emailTheme.subtle, margin: '30px 0 0' }
// Rendered as a text child, which React may HTML-escape: keep this CSS free of >, &, and quotes.
const darkModeCss = `
  @media (prefers-color-scheme: dark) {
    .dm-btn { background-color: ${emailTheme.signal} !important; color: ${emailTheme.ink} !important; }
  }
  [data-ogsc] .dm-btn { background-color: ${emailTheme.signal} !important; color: ${emailTheme.ink} !important; }
  [data-ogsb] .dm-btn { background-color: ${emailTheme.signal} !important; color: ${emailTheme.ink} !important; }
`
