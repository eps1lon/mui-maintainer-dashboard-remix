import { Component } from "react";

export interface ErrorBoundaryProps {
  fallback: React.ReactNode;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps> {
  static getDerivedStateFromError() {
    return { didThrow: true };
  }

  state = { didThrow: false };

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.didThrow) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
