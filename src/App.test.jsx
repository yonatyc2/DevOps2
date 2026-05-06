import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('an always true assertion', () => {
  it('should be equal to 2', () => {
    expect(1+1).toEqual(2)
  })
})

describe('App', () => {
  it('renders the navigation brand', () => {
    render(<App />)
    expect(screen.getByText(/DevOps Assistant/i)).toBeInTheDocument()
  })

  it('renders all nav links', () => {
    render(<App />)
    const nav = document.querySelector('nav')
    const navText = nav.textContent
    expect(navText).toMatch(/Log Analyzer/i)
    expect(navText).toMatch(/Cert Monitor/i)
    expect(navText).toMatch(/Docker Registry/i)
    expect(navText).toMatch(/Server Grid/i)
    expect(navText).toMatch(/AI Assistant/i)
  })
})