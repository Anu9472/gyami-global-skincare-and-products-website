import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return <div className="page shell not-found"><span>404</span><h1>This page is not part of the collection.</h1><p>Return to the GYAMI Global experience.</p><Link className="button button--primary" to="/">Return home</Link></div>;
}
