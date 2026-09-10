import { BrandLockup } from '../components/BrandLockup';

export function DocHeader() {
  return (
    <header className="docHeader">
      <BrandLockup href="/" className="docBrand" size={28} />
    </header>
  );
}
