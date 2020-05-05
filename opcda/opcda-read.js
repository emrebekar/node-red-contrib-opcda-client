module.exports = function(RED) {
	const opcda = require('node-opc-da');
	
	const errorCode = {
		0x80040154 : "Clsid is not found.",
		0x00000005 : "Access denied. Username and/or password might be wrong.",
		0xC0040006 : "The Items AccessRights do not allow the operation.",
		0xC0040004 : "The server cannot convert the data between the specified format/ requested data type and the canonical data type.",
		0xC004000C : "Duplicate name not allowed.",
		0xC0040010 : "The server's configuration file is an invalid format.",
		0xC0040009 : "The filter string was not valid",
		0xC0040001 : "The value of the handle is invalid. Note: a client should never pass an invalid handle to a server. If this error occurs, it is due to a programming error in the client or possibly in the server.",
		0xC0040008 : "The item ID doesn't conform to the server's syntax.",
		0xC0040203 : "The passed property ID is not valid for the item.",
		0xC0040011 : "Requested Object (e.g. a public group) was not found.",
		0xC0040005 : "The requested operation cannot be done on a public group.",
		0xC004000B : "The value was out of range.",
		0xC0040007 : "The item ID is not defined in the server address space (on add or validate) or no longer exists in the server address space (for read or write).",
		0xC004000A : "The item's access path is not known to the server.",
		0x0004000E : "A value passed to WRITE was accepted but the output was clamped.",
		0x0004000F : "The operation cannot be performed because the object is being referenced.",
		0x0004000D : "The server does not support the requested data rate but will use the closest available rate.",
		0x00000061 : "Clsid syntax is invalid"
	};
    
	function OPCDARead(config) {
        RED.nodes.createNode(this,config);
        let node = this;
		let groupStatus = "";
		
		node.config = config;
		
		let serverNode = RED.nodes.getNode(config.server);
		let opcSyncIO, opcItemMgr, opcGroup, serverHandles, clientHandles;
		
		let reading = false;
		
		if(!serverNode){
			updateStatus("grouperror");
			node.error("Please select a server.")
			return;
		}
		
		serverNode.addGroupNode(this);
		
		if(serverNode.isConnected){
			serverNode.reconnect();
		}
		
		serverNode.addListener("__server_status__", function(status) {
			updateStatus(status);
		});
		
		node.init = async function init(createdGroup){	
			try{
				serverHandles = [];
				clientHandles = [];
				reading = false;

				opcItemMgr = await createdGroup.getItemManager();
				opcSyncIO = await createdGroup.getSyncIO();
				
				let clientHandle = 1;
				var itemsList = config.groupitems.map(e => {
					return { itemID: e, clientHandle: clientHandle++ };
				});
							
				var addedItems = await opcItemMgr.add(itemsList);
								
				for(let i=0; i < addedItems.length; i++ ){
					const addedItem = addedItems[i];
					const item = itemsList[i];

					if (addedItem[0] !== 0) {
						node.warn(`Error adding item '${item.itemID}': ${errorMessage(addedItem[0])}`);
					} 
					else {
						serverHandles.push(addedItem[1].serverHandle);
						clientHandles[item.clientHandle] = item.itemID;
					}
				}
				
				updateStatus('ready');
			}
			catch(e){
				updateStatus('grouperror');
                onError(e);
				serverNode.reconnect();
			}
		}
	
		async function destroy(){
			try {
                if (opcSyncIO) {
                    await opcSyncIO.end();
                    opcSyncIO = null;
                }
                
                if (opcItemMgr) {
                    await opcItemMgr.end();
                    opcItemMgr = null;
                }
                
                if (opcGroup) {
                    await opcGroup.end();
                    opcGroup = null;
                }
            } 
			catch (e) {
				updateStatus('grouperror');
                onError(e);
            }
		}
	
		let oldValues = [];
		async function readGroup(cache){
			try{
				reading = true;
				var dataSource = cache ? opcda.constants.opc.dataSource.CACHE : opcda.constants.opc.dataSource.DEVICE;

				let valuesTmp = [];
				await opcSyncIO.read(dataSource, serverHandles).then(function(valueSets){
					var datas = [];
					
					let changed = false;
					
					for(let i in valueSets){
						
						if(config.datachange){
							var oldValue = oldValues[i];
							if(!changed){
								if(oldValues.length != valueSets.length || valueSets[i].value != oldValues[i]){
									changed = true;
								}
							}
							
							valuesTmp[i] = valueSets[i].value;					
						}
						
						var quality;
						
						if(valueSets[i].quality >= 0 && valueSets[i].quality < 64){
							quality = "BAD";
						}
						else if(valueSets[i].quality >= 64 && valueSets[i].quality < 192){
							quality = "UNCERTAIN";
						}
						else if(valueSets[i].quality >= 19 && valueSets[i].quality <= 219){
							quality = "GOOD";
						}
						else{
							quality = "UNKNOWN";
						}
						
						var data = {
							itemID: clientHandles[valueSets[i].clientHandle],
							errorCode: valueSets[i].errorCode,
							quality: quality,
							timestamp: valueSets[i].timestamp,
							value: valueSets[i].value
						}
						
						datas.push(data);
					}
					
					if(config.datachange){
						oldValues = valuesTmp;
						if(changed){
							var msg = { payload: datas };
							node.send(msg);						
						}		
					}
					else{
						var msg = { payload: datas };
						node.send(msg);		
					}
					
					if(config.groupitems.length == valuesTmp.length){
						updateStatus('ready');
					}
					else{
						updateStatus('mismatch');
					}

				});
			}
			catch(e){
				updateStatus('readerror');
                onError(e);
			}
			finally{
				reading = false;
			}
		}
	
		function updateStatus(status){
			groupStatus = status;
			switch(status){
				case "disconnected":
					node.status({fill:"red",shape:"ring",text:"Disconnected"});
					break;
				case "connecting":
					node.status({fill:"yellow",shape:"ring",text:"Connecting"});
					break;
				case "ready":
					node.status({fill:"green",shape:"ring",text:"Ready"});
					break;
				case "reading":
					node.status({fill:"blue",shape:"ring",text:"Reading Data"});
					break;
				case "servererror":
					node.status({fill:"red",shape:"ring",text:"Server Error"});
					break;
				case "grouperror":
					node.status({fill:"red",shape:"ring",text:"Group Error"});
					break;
				case "readerror":
					node.status({fill:"red",shape:"ring",text:"Read Error"});
					break;
				case "mismatch":
					node.status({fill:"red",shape:"ring",text:"Mismatch"});
					break;
				default:
					node.status({fill:"grey",shape:"ring",text:"Unknown"});
					break;
			}
		}
		
		function onError(e){
			var msg = errorMessage(e);
			node.error(msg);
		}
		
		function errorMessage(e){
			var msg = errorCode[e] ? errorCode[e] : e.message;
			return msg;
		}
		
		node.on('input', function(msg){
			if(serverNode.isConnected && !reading){
				readGroup(config.cache);
			}
        });	
	
		node.on('close', function(){
			destroy();
			serverNode.removeListener("__server_status__");
		});
    }
	
    RED.nodes.registerType("opcda-read",OPCDARead);
}
