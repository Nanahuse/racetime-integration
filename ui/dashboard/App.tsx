import {RACES_REPLICANT, type RacesState} from "@nanahuse/racetime-protocol";
import {useState} from "react";
import {Badge} from "./components/common";
import {Mappings} from "./components/Mappings";
import {Overview} from "./components/Overview";
import {Settings} from "./components/Settings";
import {useReplicant} from "./hooks/use-replicant";
import {statusTone} from "./model/status";

type Tab = "overview" | "mappings" | "settings";

const TABS: ReadonlyArray<{id: Tab; label: string}> = [
	{id: "overview", label: "Overview"},
	{id: "mappings", label: "Mappings"},
	{id: "settings", label: "Settings"},
];

export function App() {
	const [tab, setTab] = useState<Tab>("overview");
	const races = useReplicant<RacesState>(RACES_REPLICANT);
	const state = races.ready ? (races.value ? "ready" : "idle") : "loading";

	return (
		<div className='app'>
			<header>
				<div>
					<p className='eyebrow'>RACETIME INTEGRATION</p>
					<h1>RaceTime Integration</h1>
				</div>
				<div className='statusbar'>
					<Badge
						label='races'
						state={state}
						tone={statusTone(state)}
					/>
					<Badge
						label='監視中'
						state={`${races.value?.races.length ?? 0}`}
						tone='neutral'
					/>
				</div>
			</header>
			<nav className='tabs'>
				{TABS.map((item) => (
					<button
						key={item.id}
						type='button'
						className={tab === item.id ? "active" : ""}
						onClick={() => setTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</nav>
			<main>
				{tab === "overview" && <Overview races={races.value} />}
				{tab === "mappings" && <Mappings />}
				{tab === "settings" && <Settings />}
			</main>
		</div>
	);
}
