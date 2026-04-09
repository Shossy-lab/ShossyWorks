// Mock for the "server-only" package in test environment.
// The real package throws when imported outside a server component.
// This mock does nothing, allowing server-side code to be tested.
export {};
