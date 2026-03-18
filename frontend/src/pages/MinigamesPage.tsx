import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../components/ui';

export function MinigamesPage() {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,rgba(32,39,69,0.98),rgba(43,84,121,0.93)_52%,rgba(214,152,80,0.9))] p-6 text-white shadow-[0_36px_90px_-54px_rgba(15,23,42,0.8)] sm:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.34em] text-white/60">Minigames</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              Reserved for quick-play formats.
            </h1>
            <p className="mt-3 text-sm text-white/80 sm:text-base">
              This tab is in place for later use when smaller interactive games, streak challenges,
              or instant-win mechanics are ready to ship.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className="border border-white/20 bg-white/10 text-white">Placeholder</Badge>
            <Badge className="border border-white/20 bg-white/10 text-white">Future release</Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Planned</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Daily challenges</h2>
          <p className="mt-3 text-sm text-gray-600">
            Short-form prediction loops and challenge mechanics can slot into this area later.
          </p>
        </Card>

        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Design</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Fast, distinct interactions</h2>
          <p className="mt-3 text-sm text-gray-600">
            The route is live now so the surrounding navigation, layout, and access flow are already
            stable when gameplay arrives.
          </p>
        </Card>

        <Card className="bg-white/88">
          <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Next step</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Back to picks</h2>
          <p className="mt-3 text-sm text-gray-600">
            Live event predictions remain the active experience while this section is held for later.
          </p>
          <div className="mt-5">
            <Link to="/football">
              <Button size="sm">Open football</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
