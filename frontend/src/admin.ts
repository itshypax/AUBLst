import { mount } from 'svelte';
import './styles/app.css';
import AdminPage from './components/admin/AdminPage.svelte';
import { initSettings } from './lib/state.svelte';

// Die Zentrale braucht nur api_base und das Farbschema, keine Sitzung.
initSettings();

export default mount(AdminPage, { target: document.getElementById('app')! });
