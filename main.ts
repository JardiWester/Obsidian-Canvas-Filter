import { CanvasData, CanvasEdgeData, CanvasFileData, CanvasLinkData, CanvasNodeData, CanvasTextData } from 'obsidian/canvas';
import { App, FuzzySuggestModal, getAllTags, ItemView, Notice, Plugin } from 'obsidian';

export interface CanvasGroupData extends CanvasNodeData {
	type: 'group',
	label: string
}

function isCanvasGroupData(node: CanvasNodeData): node is CanvasGroupData {
	return (node as any)?.type === 'group';
}

function nodeBondingBoxContains(outerNode: CanvasNodeData, innerNode: CanvasNodeData) {
	return outerNode.x <= innerNode.x
		&& (outerNode.x + outerNode.width) >= (innerNode.x + innerNode.width)
		&& outerNode.y <= innerNode.y
		&& (outerNode.y + outerNode.height) >= (innerNode.y + innerNode.height);
}

function showOnlyNodes(canvas: any, idsToShow?: Set<string>, mode: "hide" | "fade" = "hide") {
	const nodes = canvas.nodes.values();

	for (const node of nodes) {
		if (idsToShow === undefined || idsToShow.has(node.id)) {
			node.nodeEl.style.display = "";
			node.nodeEl.style.opacity = "1";
		} else {
			if (mode === "hide") {
				node.nodeEl.style.display = "none";
			} else if (mode === "fade") {
				node.nodeEl.style.display = "";
				node.nodeEl.style.opacity = "0.3";
			}
		}
	}
}

function showOnlyEdges(canvas: any, idsToShow?: Set<string>, mode: "hide" | "fade" = "hide") {
	const edges = canvas.edges.values();

	for (const edge of edges) {
		if (idsToShow === undefined || idsToShow.has(edge.id)) {
			edge.lineGroupEl.style.display = "";
			edge.lineEndGroupEl.style.display = "";
			edge.lineGroupEl.style.opacity = "1";
			edge.lineEndGroupEl.style.opacity = "1";
		} else {
			if (mode === "hide") {
				edge.lineGroupEl.style.display = "none";
				edge.lineEndGroupEl.style.display = "none";
			} else if (mode === "fade") {
				edge.lineGroupEl.style.display = "";
				edge.lineEndGroupEl.style.display = "";
				edge.lineGroupEl.style.opacity = "0.3";
				edge.lineEndGroupEl.style.opacity = "0.3";
			}
		}
	}
}

function getGroupsFor(allNodes: CanvasNodeData[], nonGroupNodes: CanvasNodeData[]) {
	return allNodes.filter(x => isCanvasGroupData(x)
		&& nonGroupNodes.some(fn => nodeBondingBoxContains(x, fn)));
}

function getEdgesWhereBothNodesInSet(allEdges: CanvasEdgeData[], nodeIds: Set<string>) {
	return allEdges
		.filter(edge => nodeIds.has(edge.fromNode)
			&& nodeIds.has(edge.toNode));
}


var nodeIdsToShowMemory = new Set<string>();

var nodeIdsToHideMemory = new Set<string>();

export default class CanvasFilterPlugin extends Plugin {

	private displayMode: "hide" | "fade" = "hide";

	private toggleDisplayMode() {
		this.displayMode = this.displayMode === "hide" ? "fade" : "hide";
		new Notice(`Display mode switched to: ${this.displayMode}`);
	}

	private resetMemory() {
		//nodeIdsToShowMemory.clear;


		nodeIdsToShowMemory = new Set<string>();

		nodeIdsToHideMemory = new Set<string>();
	}
	
	private ifActiveViewIsCanvas = (commandFn: (canvas: any, canvasData: CanvasData) => void) => (checking: boolean) => {
		const canvasView = this.app.workspace.getActiveViewOfType(ItemView);

		if (canvasView?.getViewType() !== 'canvas') {
			if (checking) {
				return false;
			}
			return;
		}

		if (checking) {
			return true;
		}

		const canvas = (canvasView as any).canvas;
		if (!canvas) {
			return;
		};

		const canvasData = canvas.getData() as CanvasData;

		if (!canvasData) {
			return;
		};

		return commandFn(canvas, canvasData);
	}

	private showConnectedNodes = (
		canvas: any,
		canvasData: CanvasData,
		showUpstreamNodes: boolean,
		showDownstreamNodes: boolean) => {
		const selection: any = Array.from(canvas.selection);
		if (selection.length === 0) {
			new Notice("Please select at least one node");
			return;
		}

		const nodesIdsToShow = new Set(selection.map((x: any) => x.id).filter((x: any) => x) as string[]);
		const edgesIdsToShow = new Set<string>();
		const addedNodes = new Set(nodesIdsToShow);
		while (addedNodes.size > 0) {
			const previousAddedNodes = new Set(addedNodes);
			addedNodes.clear();

			if (showUpstreamNodes) {
				const outgoingEdges = canvasData.edges.filter(x => previousAddedNodes.has(x.fromNode));
				for (const edge of outgoingEdges) {
					edgesIdsToShow.add(edge.id);
					if (!nodesIdsToShow.has(edge.toNode)) {
						nodesIdsToShow.add(edge.toNode);
						addedNodes.add(edge.toNode);
					}
				}
			}

			if (showDownstreamNodes) {
				const incomingEdges = canvasData.edges.filter(x => previousAddedNodes.has(x.toNode));
				for (const edge of incomingEdges) {
					edgesIdsToShow.add(edge.id);
					if (!nodesIdsToShow.has(edge.fromNode)) {
						nodesIdsToShow.add(edge.fromNode);
						addedNodes.add(edge.fromNode);
					}
				}
			}
		}

		const groupNodesToShow = getGroupsFor(
			canvasData.nodes,
			canvasData.nodes.filter(x => nodesIdsToShow.has(x.id)));

		for (const node of groupNodesToShow) {
			nodesIdsToShow.add(node.id);
		}

		showOnlyNodes(canvas, nodesIdsToShow, this.displayMode);

		showOnlyEdges(canvas, edgesIdsToShow, this.displayMode);

		this.resetMemory();
		
		nodeIdsToShowMemory = nodesIdsToShow;
	}



	async onload() {

		this.addCommand({
			id: 'toggle-display-mode',
			name: 'Toggle display mode (hide/fade)',
			callback: () => this.toggleDisplayMode()
		});

		this.addCommand({
			id: 'show-all',
			name: 'show ALL',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				showOnlyNodes(canvas, undefined, this.displayMode);

				showOnlyEdges(canvas, undefined, this.displayMode);

				this.resetMemory();
			})
		});

		this.addCommand({
			id: 'show-only-same-color',
			name: 'show matching COLOR',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const selection: any = Array.from(canvas.selection);
				if (selection.length === 0) {
					new Notice("Please select at least one node");
					return;
				}

				const colorsToShow = new Set(selection.map((x: any) => x.color) as (string | undefined)[]);

				if (colorsToShow.has("")) {
					new Notice("One of selected nodes has no color, so colorless nodes will be visible");
				}

				const nodes = canvasData.nodes;

				const nonGroupNodesToShow =
					nodes.filter((x: CanvasFileData | CanvasTextData | CanvasLinkData | CanvasGroupData) => x.type !== 'group'
						&& colorsToShow.has(x.color ?? ""));

				const groupNodesToShow = getGroupsFor(nodes, nonGroupNodesToShow);

				const shownNodeIds = new Set([...nonGroupNodesToShow, ...groupNodesToShow].map(x => x.id));
				showOnlyNodes(canvas, shownNodeIds, this.displayMode);

				const shownEdgeIds = new Set(
					getEdgesWhereBothNodesInSet(canvasData.edges, shownNodeIds).map(x => x.id))

				showOnlyEdges(canvas, shownEdgeIds, this.displayMode);

				this.resetMemory()

				nodeIdsToShowMemory = shownNodeIds
			})
		});

		this.addCommand({
			id: 'show-hide',
			name: 'selected HIDE',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const selection: any = Array.from(canvas.selection);
				if (selection.length === 0) {
					new Notice("Please select at least one node");
					return;
				}

				for (const selected of selection) {
					const node = canvas.nodes.get(selected.id);
					if (node) {
						if(this.displayMode === "hide"){
							node.nodeEl.hide();
						}else{
							node.nodeEl.style.display = "";
							node.nodeEl.style.opacity = "0.3";
						}
					}
					const edge = canvas.edges.get(selected.id);
					if (edge) {
						if(this.displayMode === "hide"){
							edge.lineGroupEl.style.display = "none";
							edge.lineEndGroupEl.style.display = "none";
						}else{
							edge.lineGroupEl.style.display = "";
							edge.lineEndGroupEl.style.display = "";
							edge.lineGroupEl.style.opacity = "0.3";
							edge.lineEndGroupEl.style.opacity = "0.3";
						}
					}
				}

				canvas.deselectAll();

				nodeIdsToShowMemory = selection;
			})
		});

		this.addCommand({
			id: 'show-hide-connected',
			name: 'selected with connections HIDE',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const selection: any = Array.from(canvas.selection);
				if (selection.length === 0) {
					new Notice("Please select at least one node");
					return;
				}

				for (const selected of selection) {
					const node = canvas.nodes.get(selected.id);
					if (node) {
						if(this.displayMode === "hide") {
							node.nodeEl.hide();
						} else {
							node.nodeEl.style.display = "";
							node.nodeEl.style.opacity = "0.3";
						}

						const connections = canvasData.edges.filter(x => x.fromNode === node.id || x.toNode === node.id);
						for (const connection of connections) {
							const edge = canvas.edges.get(connection.id);
							if (edge) {
								if(this.displayMode === "hide") {
									edge.lineGroupEl.style.display = "none";
									edge.lineEndGroupEl.style.display = "none";
								} else {
									edge.lineGroupEl.style.display = "";
									edge.lineEndGroupEl.style.display = "";
									edge.lineGroupEl.style.opacity = "0.3";
									edge.lineEndGroupEl.style.opacity = "0.3";
								}
							}
						}
					}

					const edge = canvas.edges.get(selected.id);
					if (edge) {
						if(this.displayMode === "hide") {
							edge.lineGroupEl.style.display = "none";
							edge.lineEndGroupEl.style.display = "none";
						} else {
							edge.lineGroupEl.style.display = "";
							edge.lineEndGroupEl.style.display = "";
							edge.lineGroupEl.style.opacity = "0.3";
							edge.lineEndGroupEl.style.opacity = "0.3";
						}
					}
				}

				canvas.deselectAll();

				nodeIdsToShowMemory = selection;
			})
		});

		this.addCommand({
			id: 'show-connected-nodes-from-to',
			name: 'show with ARROWS TO/FROM',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {
				this.showConnectedNodes(canvas, canvasData, true, true);

				this.resetMemory();
			})
		});

		this.addCommand({
			id: 'show-connected-nodes-from',
			name: 'show with ARROWS FROM',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {
				this.showConnectedNodes(canvas, canvasData, true, false);


				this.resetMemory();
			})
		});

		this.addCommand({
			id: 'show-connected-nodes-to',
			name: 'show with ARROWS TO',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {
				this.showConnectedNodes(canvas, canvasData, false, true);

				this.resetMemory();
			})


		});

		this.addCommand({
			id: 'showtags',
			name: 'by TAG',



			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const tagsObject = (this.app.metadataCache as any).getTags() as Record<string, number>;
				const tags = Object.keys(tagsObject);

				const cardTags = canvasData.nodes
					.flatMap(x => {
						if (x.type !== "text") {
							return [];
						}
						return [...x.text.matchAll(/#[^\s]+/g)].map(x => x[0]);
					});



				var groupsToShow = new Array<CanvasNodeData>();

				var nodeIdsToShow = new Set<string>();

				var edgesToShow = new Array<CanvasEdgeData>()



				new TagSelectionModal(
					this.app,
					[...new Set([...tags, ...cardTags])],
					(tag: string) => {

						const nodesToShow = canvasData.nodes.filter(node => {

							if (node.type === "file") {
								const metadata = this.app.metadataCache.getCache(node.file);
								return metadata?.tags?.some(x => x.tag === tag);
							}

							if (node.type === "text") {
								return node.text.indexOf(tag) !== -1;
							}

							return false;
						});

						groupsToShow = getGroupsFor(canvasData.nodes, nodesToShow);

						nodeIdsToShow = new Set(nodesToShow.map(x => x.id));

						edgesToShow = getEdgesWhereBothNodesInSet(canvasData.edges, nodeIdsToShow);

						for (const group of groupsToShow) {
							nodeIdsToShow.add(group.id);
						}

						//new Notice('Hello, world!');

						showOnlyNodes(canvas, nodeIdsToShow);

						showOnlyEdges(canvas, new Set(edgesToShow.map(x => x.id)));


						this.resetMemory();
					}).open();


			})
		});


		this.addCommand({
			id: 'Hide-tags',
			name: 'Hide TAG',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {





				const tagsObject = (this.app.metadataCache as any).getTags() as Record<string, number>;
				const tags = Object.keys(tagsObject);

				const cardTags = canvasData.nodes
					.flatMap(x => {
						if (x.type !== "text") {
							return [];
						}
						return [...x.text.matchAll(/#[^\s]+/g)].map(x => x[0]);
					});



				var groupsToShow = new Array<CanvasNodeData>();

				var nodeIdsToShow = new Set<string>();

				var edgesToShow = new Array<CanvasEdgeData>()



				new TagSelectionModal(
					this.app,
					[...new Set([...tags, ...cardTags])],
					(tag: string) => {

						const nodesToShow = canvasData.nodes.filter(node => {

							if (node.type === "file") {
								const metadata = this.app.metadataCache.getCache(node.file);
								return metadata?.tags?.some(x => x.tag != tag);
								// TODO search subpaths?
							}

							if (node.type === "text") {
								return node.text.indexOf(tag) == -1;
							}

							return false;
						});

						groupsToShow = getGroupsFor(canvasData.nodes, nodesToShow);

						nodeIdsToShow = new Set(nodesToShow.map(x => x.id));

						edgesToShow = getEdgesWhereBothNodesInSet(canvasData.edges, nodeIdsToShow);

						for (const group of groupsToShow) {
							nodeIdsToShow.add(group.id);
						}

						showOnlyNodes(canvas, nodeIdsToShow, this.displayMode);

						showOnlyEdges(canvas, new Set(edgesToShow.map(x => x.id)), this.displayMode);

						this.resetMemory();

					}).open();


			})
		});


		this.addCommand({
			id: 'show-tagsAditive',
			name: 'by -TAG Aditive',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const tagsObject = (this.app.metadataCache as any).getTags() as Record<string, number>;
				const tags = Object.keys(tagsObject);

				const cardTags = canvasData.nodes
					.flatMap(x => {
						if (x.type !== "text") {
							return [];
						}
						return [...x.text.matchAll(/#[^\s]+/g)].map(x => x[0]);
					});



				var groupsToShow = new Array<CanvasNodeData>();

				var nodeIdsToShow = new Set<string>();

				var edgesToShow = new Array<CanvasEdgeData>()



				new TagSelectionModal(
					this.app,
					[...new Set([...tags, ...cardTags])],
					(tag: string) => {

						const nodesToShow = canvasData.nodes.filter(node => {

							if (node.type === "file") {
								const metadata = this.app.metadataCache.getCache(node.file);
								return metadata?.tags?.some(x => x.tag != tag);
								// TODO search subpaths?
							}

							if (node.type === "text") {
								return node.text.indexOf(tag) == -1;
							}

							return false;
						});

						groupsToShow = getGroupsFor(canvasData.nodes, nodesToShow);

						nodeIdsToShow = new Set(nodesToShow.map(x => x.id));



						for (const nodeId of nodeIdsToShow) {

							if (!nodeIdsToShowMemory.has(nodeId)) {
								nodeIdsToShowMemory.add(nodeId);
							}
						}


						  //+= nodeIdsToShow;






						edgesToShow = getEdgesWhereBothNodesInSet(canvasData.edges, nodeIdsToShowMemory);

						for (const group of groupsToShow) {
							nodeIdsToShow.add(group.id);
						}

						//new Notice('Hello, world!');

						showOnlyNodes(canvas, nodeIdsToShowMemory);

						showOnlyEdges(canvas, new Set(edgesToShow.map(x => x.id)));

					}).open();


			})
		});




		this.addCommand({
			id: 'showtagsAditive',
			name: 'by TAG Aditive',
			checkCallback: this.ifActiveViewIsCanvas((canvas, canvasData) => {

				const tagsObject = (this.app.metadataCache as any).getTags() as Record<string, number>;
				const tags = Object.keys(tagsObject);

				const cardTags = canvasData.nodes
					.flatMap(x => {
						if (x.type !== "text") {
							return [];
						}
						return [...x.text.matchAll(/#[^\s]+/g)].map(x => x[0]);
					});



				var groupsToShow = new Array<CanvasNodeData>();

				var nodeIdsToShow = new Set<string>();

				var edgesToShow = new Array<CanvasEdgeData>()



				new TagSelectionModal(
					this.app,
					[...new Set([...tags, ...cardTags])],
					(tag: string) => {

						const nodesToShow = canvasData.nodes.filter(node => {

							if (node.type === "file") {
								const metadata = this.app.metadataCache.getCache(node.file);
								return metadata?.tags?.some(x => x.tag === tag);
								// TODO search subpaths?
							}

							if (node.type === "text") {
								return node.text.indexOf(tag) !== -1;
							}

							return false;
						});

						groupsToShow = getGroupsFor(canvasData.nodes, nodesToShow);

						nodeIdsToShow = new Set(nodesToShow.map(x => x.id));



						for (const nodeId of nodeIdsToShow) {

							if (!nodeIdsToShowMemory.has(nodeId)) {
								nodeIdsToShowMemory.add(nodeId);
							}
						}


						//+= nodeIdsToShow;






						edgesToShow = getEdgesWhereBothNodesInSet(canvasData.edges, nodeIdsToShowMemory);

						for (const group of groupsToShow) {
							nodeIdsToShow.add(group.id);
						}

						//new Notice('Hello, world!');

						showOnlyNodes(canvas, nodeIdsToShowMemory);

						showOnlyEdges(canvas, new Set(edgesToShow.map(x => x.id)));

					}).open();


			})
		});

		
	}
}

class TagSelectionModal extends FuzzySuggestModal<string> {




	constructor(
		app: App,
		private tags: string[],
		private onSelect: (tag: string) => void) {
		super(app);

		new Notice('Hello, world!');
	}

	getItems(): string[] {
		return this.tags;
	}
	getItemText(item: string): string {
		return item;
	}
	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}
}
