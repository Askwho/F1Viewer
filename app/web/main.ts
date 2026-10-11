import "@fontsource-variable/saira/wdth.css";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });

// Dev server only: poke at the live store from the console.
if (import.meta.env.DEV) import("./lib/feed.svelte.ts").then(({ feed }) => ((window as any).feed = feed));
