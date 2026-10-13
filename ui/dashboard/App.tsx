import {RACES_REPLICANT, type RacesState} from "@nanahuse/racetime-protocol";
import {useState} from "react";
import {Badge} from "./components/common";
import {Mappings} from "./components/Mappings";
import {Overview} from "./components/Overview";
import {Settings} from "./components/Settings";
import {usePlayerManagerStatus} from "./hooks/use-player-manager-status";
import {useReplicant} from "./hooks/use-replicant";
import type {EditorState} from "./model/editor";

const PLAYER_MANAGER_LABELS = {
	ready: "Ready",
	loading: "Loading",
	unavailable: "Unavailable",
	error: "Error",
} as const;

const PLAYER_MANAGER_TONES = {
	ready: "success",
	loading: "progress",
	unavailable: "warning",
	error: "error",
} as const;

type Tab = "overview" | "mappings" | "settings";

const TABS: ReadonlyArray<{id: Tab; label: string}> = [
	{id: "overview", label: "Overview"},
	{id: "mappings", label: "Mappings"},
	{id: "settings", label: "Settings"},
];

const IDLE_EDITOR: EditorState = {dirty: false, busy: false};

export function App() {
	const [tab, setTab] = useState<Tab>("overview");
	const [editorState, setEditorState] = useState<EditorState>(IDLE_EDITOR);
	const [confirmTab, setConfirmTab] = useState<Tab | null>(null);
	const races = useReplicant<RacesState>(RACES_REPLICANT);
	const playerManager = usePlayerManagerStatus();
	const playerManagerMessage =
		"message" in playerManager ? playerManager.message : undefined;

	const raceCount = races.value?.races.length ?? 0;
	const racesState = !races.ready
		? "Loading"
		: raceCount > 0
			? "Monitoring"
			: "Idle";
	const racesTone = !races.ready
		? "progress"
		: raceCount > 0
			? "success"
			: "neutral";

	const switchTab = (next: Tab) => {
		setEditorState(IDLE_EDITOR);
		setTab(next);
	};

	const requestTab = (next: Tab) => {
		if (next === tab || editorState.busy) return;
		if (editorState.dirty) {
			setConfirmTab(next);
			return;
		}
		switchTab(next);
	};

	const confirmDiscardAndSwitch = () => {
		if (editorState.busy) return;
		const next = confirmTab;
		if (next === null) return;
		setConfirmTab(null);
		switchTab(next);
	};

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
						state={racesState}
						tone={racesTone}
					/>
					<Badge
						label='監視中'
						state={`${raceCount}`}
						tone='neutral'
					/>
					<Badge
						label='Player Manager'
						state={PLAYER_MANAGER_LABELS[playerManager.state]}
						tone={PLAYER_MANAGER_TONES[playerManager.state]}
						title={playerManagerMessage}
					/>
				</div>
			</header>
			<nav className='tabs'>
				{TABS.map((item) => (
					<button
						key={item.id}
						type='button'
						className={tab === item.id ? "active" : ""}
						disabled={editorState.busy}
						onClick={() => requestTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</nav>
			<main>
				{tab === "overview" && (
					<Overview
						races={races.value}
						onStateChange={setEditorState}
					/>
				)}
				{tab === "mappings" && <Mappings onStateChange={setEditorState} />}
				{tab === "settings" && <Settings onStateChange={setEditorState} />}
			</main>
			{confirmTab && (
				<div className='dialog-backdrop'>
					<div className='dialog'>
						<p>未保存の変更があります。破棄して移動しますか？</p>
						<div className='button-row'>
							<button
								type='button'
								disabled={editorState.busy}
								onClick={confirmDiscardAndSwitch}
							>
								破棄して移動
							</button>
							<button
								type='button'
								onClick={() => setConfirmTab(null)}
							>
								キャンセル
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
