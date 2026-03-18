import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../components/ui';

export function PromotionsPage() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,rgba(24,46,43,0.98),rgba(47,114,106,0.93)_54%,rgba(212,128,53,0.9))] p-6 text-white shadow-[0_36px_90px_-54px_rgba(15,23,42,0.8)] sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.34em] text-white/60">Promotions</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              Offers and boosts will land here.
            </h1>
            <p className="mt-3 text-sm text-white/80 sm:text-base">
              This tab is ready for future promos such as bonus-point weekends, odds boosts, and
              time-limited featured fixtures.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border border-white/20 bg-white/10 text-white">Coming soon</Badge>
            <Badge className="border border-white/20 bg-white/10 text-white">Promo-ready shell</Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Planned</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Featured campaigns</h2>
          <p className="mt-3 text-sm text-gray-600">
            Highlighted promotions, seasonal drops, and event-specific boosts will be surfaced in
            this panel.
          </p>
        </Card>

        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Value</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Token-led offers</h2>
          <p className="mt-3 text-sm text-gray-600">
            Promotions will plug into the token wallet and surface clear value before a user joins.
          </p>
        </Card>

        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Next step</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Keep exploring</h2>
          <p className="mt-3 text-sm text-gray-600">
            The live prediction flow is already available while this section is being built out.
          </p>
          <div className="mt-5">
            <Link to="/events">
              <Button size="sm">Browse events</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
