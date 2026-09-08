import { createBrandAction } from '@/lib/actions/brands';

export default function NewBrandPage() {
  return (
    <section>
      <h1>Add a brand</h1>

      <form action={createBrandAction} className="form">
        <fieldset>
          <legend>Details</legend>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Client phone (E.164)
            <input name="client_phone" placeholder="+614xxxxxxxx" required />
          </label>
          <label>
            Approver
            <select name="approver" defaultValue="operator">
              <option value="operator">Operator</option>
              <option value="client">Client</option>
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="active">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Brand voice onboarding</legend>
          <p className="hint">
            One item per line. All optional here. You can fill these in later from the voice profile
            editor instead.
          </p>
          <label>
            Tone
            <textarea name="tone" rows={3} placeholder={'warm\nplayful\nconcise'} />
          </label>
          <label>
            Dos
            <textarea name="dos" rows={3} />
          </label>
          <label>
            Don&apos;ts
            <textarea name="donts" rows={3} />
          </label>
          <label>
            Example captions (2–3)
            <textarea name="example_captions" rows={4} />
          </label>
        </fieldset>

        <button type="submit" className="btn-primary">
          Create brand
        </button>
      </form>
    </section>
  );
}
