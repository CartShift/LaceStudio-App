import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { ModelWizard } from "@/components/models/model-wizard";
import { LegacyModelCreateForm } from "@/components/models/legacy-model-create-form";

export default function NewModelPage() {
	const wizardEnabled = process.env.ENABLE_MODEL_CREATION_WIZARD === "true";

	return (
		<PageScaffold className="space-y-4">
			<PageHeader
				title={wizardEnabled ? "Model Setup" : "New Model"}
				description={wizardEnabled ? "A guided setup for a new model profile." : "Create a model profile for campaigns."}
			/>

			{wizardEnabled ? <ModelWizard /> : <LegacyModelCreateForm />}
		</PageScaffold>
	);
}
