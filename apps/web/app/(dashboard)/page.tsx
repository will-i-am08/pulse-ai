import Link from 'next/link';
import { listBrands } from '@/lib/data/brands';

export default async function BrandsPage() {
  const brands = await listBrands();

  return (
    <section>
      <div className="page-header">
        <h1>Brands</h1>
        <Link href="/brands/new" className="btn-primary">
          Add brand
        </Link>
      </div>

      {brands.length === 0 ? (
        <p className="empty">No brands yet — add your first one.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Approver</th>
              <th>Phone</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => (
              <tr key={brand.id}>
                <td>{brand.name}</td>
                <td>
                  <span className={`badge badge-${brand.status}`}>{brand.status}</span>
                </td>
                <td>{brand.approver}</td>
                <td>{brand.client_phone}</td>
                <td>
                  <Link href={`/brands/${brand.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
