const knx = require('knx')
const dptlib = require('knx/src/dptlib')

//Helpers
sortBy = (field) => (a, b) => {
    if (a[field] > b[field]) { return 1 } else { return -1 }
}


onlyDptKeys = (kv) => {
    return kv[0].startsWith("DPT")
}

extractBaseNo = (kv) => {
    return {
        subtypes: kv[1].subtypes,
        base: parseInt(kv[1].id.replace("DPT", ""))
    }
}

convertSubtype = (baseType) => (kv) => {
    let value = `${baseType.base}.${kv[0]}`
    return {
        value: value
        , text: value + ` (${kv[1].name})`
    }
}


toConcattedSubtypes = (acc, baseType) => {
    let subtypes =
        Object.entries(baseType.subtypes)
            .sort(sortBy(0))
            .map(convertSubtype(baseType))

    return acc.concat(subtypes)
}

readCSV = (_csv,RED) => {
    if (_csv=="") {
        RED.log.info('KnxEasy: no csv ETS found')
    }else{RED.log.info('KnxEasy: csv ETS found !')}
    // Read and decode the CSV in an Array containing:  "group address", "DPT", "Device Name"
    let fileGA = _csv.split("\n");
     // Controllo se le righe dei gruppi contengono il separatore di tabulazione
    if (fileGA[0].search("\t")==-1) {
        RED.log.error('KnxEasy: ERROR: the csv ETS file must have the tabulation as separator')
        return null;
    }   
    var ajsonOutput=new Array(); // Array: qui va l'output totale con i nodi per node-red
    for (let index = 0; index < fileGA.length; index++) {
        const element = fileGA[index].replace(/\"/g,""); // Rimuovo le virgolette
        
        if (element !== "") {
            if (element.split("\t")[1].search("-")==-1 && element.split("\t")[1].search("/")!==-1) {
                // Ho trovato una riga contenente un GA valido, cioè con 2 "/"
                if (element.split("\t")[5] == "") {
                    RED.log.error("KnxEasy: ERROR: Datapoint not set in ETS CSV. Please set the datapoint with ETS and export the group addresses again. ->" + element.split("\t")[0] + " " + element.split("\t")[1])
                    return null;
                }
                var DPTa = element.split("\t")[5].split("-")[1];
                var DPTb = "";
                try {
                     DPTb = element.split("\t")[5].split("-")[2];
                } catch (error) {
                    DPTb = "001"; // default
                }
                if (!DPTb) {
                    RED.log.warn("KnxEasy: WARNING: Datapoint not fully set (there is only the first part on the left of the '.'). I applied a default .001, but please set the datapoint with ETS and export the group addresses again. ->" + element.split("\t")[0] + " " + element.split("\t")[1] + " Datapoint: " + element.split("\t")[5]);
                    DPTb = "001"; // default
                } 
                // Trailing zeroes
                if (DPTb.length == 1) {
                    DPTb = "00" + DPTb;
                }else if (DPTb.length==2) {
                    DPTb = "0" + DPTb;
                }if (DPTb.length==3) {
                    DPTb = "" + DPTb; // stupid, but for readability
                }
                ajsonOutput.push({ga:element.split("\t")[1],dpt:DPTa+"."+DPTb,devicename:element.split("\t")[0]});
            }
        }
    }
    return ajsonOutput;
}

module.exports = (RED) => {
    RED.httpAdmin.get("/knxEasyDpts", RED.auth.needsPermission('knxEasy-config.read'), function (req, res) {
        const dpts =
            Object.entries(dptlib)
                .filter(onlyDptKeys)
                .map(extractBaseNo)
                .sort(sortBy("base"))
                .reduce(toConcattedSubtypes, [])

        res.json(dpts)
    });

    function knxEasyConfigNode(n) {
        RED.nodes.createNode(this, n)
        var node = this
        node.host = n.host
        node.port = n.port
        node.csv = readCSV(n.csv,RED,node) // Array from ETS CSV Group Addresses
        // for (let index = 0; index < node.csv.length; index++) {
        //     RED.log.info("KnxEasy: CSV " + node.csv[index].device)
        // }
        node.status = "disconnected"

        var knxErrorTimeout
        node.inputUsers = []
        node.outputUsers = []

        node.register = (userType, knxNode) => {
            userType == "in"
                ? node.inputUsers.push(knxNode)
                : node.outputUsers.push(knxNode)

            if (node.status === "connected" && knxNode.initialread) {
                node.readValue(knxNode.topic);
            }

            if (node.inputUsers.length + node.outputUsers.length === 1) {
                node.connect();
            }
        }

        node.deregister = (userType, knxNode) => {
            userType == "in"
                ? node.inputUsers = node.inputUsers.filter(x => x.id !== knxNode.id)
                : node.outputUsers = node.outputUsers.filter(x => x.id !== knxNode.id)
            if (node.inputUsers.length + node.outputUsers.length === 0) {
                node.knxConnection = null
            }
        }

        node.readInitialValues = () => {
            var readHistory = []
            let delay = 50
            node.inputUsers
                .filter(input => input.initialread)
                .forEach(input => {
                    if (input.listenallga) {
                        delay = delay + 50
                        for (let index = 0; index < node.csv.length; index++) {
                            const element = node.csv[index];
                            if (readHistory.includes(element.ga)) return
                            setTimeout(() => node.readValue(element.ga), delay)
                            readHistory.push(element.ga)
                        }                        
                    } else {
                        if (readHistory.includes(input.topic)) return
                        setTimeout(() => node.readValue(input.topic), delay)
                        delay = delay + 50
                        readHistory.push(input.topic)
                    }
                    
                })
        }

        node.readValue = topic => {
            if (node.knxConnection) {
                node.knxConnection.read(topic)
            }
        }

        node.setStatusHelper = (fill, text) => {
            function nextStatus(input) {
                input.status({ fill: fill, shape: "dot", text: text })
            }
            node.inputUsers.map(nextStatus)
            node.outputUsers.map(nextStatus)
        }

        node.setStatus = (status) => {
            node.status = status;
            switch (status) {
                case "connected":
                    node.setStatusHelper("green", "node-red:common.status.connected")
                    break
                case "knxError":
                    node.setStatusHelper("yellow", "connected, but error on knx-bus")
                    break
                case "disconnected":
                    node.setStatusHelper("red", "node-red:common.status.disconnected")
                    break
                default:
            }
        }

        node.connect = () => {
            node.setStatus("disconnected")
            node.knxConnection = new knx.Connection({
                ipAddr: node.host,
                ipPort: node.port,
                handlers: {
                    connected: () => {
                        if (knxErrorTimeout == undefined) {
                            node.setStatus("connected")
                            node.readInitialValues()
                        }
                    },
                    error: (connstatus) => {
                        node.error(connstatus)
                        if (connstatus == "E_KNX_CONNECTION") {
                            node.setStatus("knxError")
                        } else {
                            node.setStatus("disconnected")
                        }
                    }
                }
            })
            node.knxConnection.on("event", function (evt, src, dest, rawValue) {
                switch (evt) {
                    case "GroupValue_Write": {
                     
                        node.inputUsers
                            .filter(input => input.notifywrite)
                            .forEach(input => {
                                if (input.listenallga) {
                                    // Get the DPT
                                    let oGA=node.csv.filter(sga => sga.ga == dest)[0]
                                    let msg = buildInputMessage(src, dest, evt, rawValue, oGA.dpt, oGA.devicename)
                                    input.send(msg)                                    
                                }else if (input.topic == dest) {
                                    let msg = buildInputMessage(src, dest, evt, rawValue, input.dpt)
                                    input.send(msg)
                                }
                            })
                        break;
                        
                        // node.inputUsers
                        //     .filter(input => input.topic == dest && input.notifywrite)
                        //     .forEach(input => {
                        //         let msg = buildInputMessage(src, dest, evt, rawValue, input.dpt)
                        //         input.send(msg)
                        //     })
                        //     break;
                        
                    }
                    case "GroupValue_Response": {
                        
                        node.inputUsers
                            .filter(input => input.notifyresponse)
                            .forEach(input => {
                                if (input.listenallga) {
                                    // Get the DPT
                                    let oGA=node.csv.filter(sga => sga.ga == dest)[0]
                                    let msg = buildInputMessage(src, dest, evt, rawValue, oGA.dpt, oGA.devicename)
                                    input.send(msg)                                    
                                }else if (input.topic == dest) {
                                    let msg = buildInputMessage(src, dest, evt, rawValue, input.dpt)
                                    input.send(msg)
                                }
                            })
                        break;

                            // node.inputUsers
                            //     .filter(input => input.topic == dest && input.notifyresponse)
                            //     .forEach(input => {
                            //         let msg = buildInputMessage(src, dest, evt, rawValue, input.dpt)
                            //         input.send(msg)
                            //     })
                            // break;
                        
                    }
                    case "GroupValue_Read": {
                        
                        node.inputUsers
                            .filter(input => input.notifyreadrequest)
                            .forEach(input => {
                                if (input.listenallga) {
                                    // Get the DPT
                                    let oGA=node.csv.filter(sga => sga.ga == dest)[0]
                                    let msg = buildInputMessage(src, dest, evt, null, oGA.dpt, oGA.devicename)
                                    input.send(msg)                                    
                                }else if (input.topic == dest) {
                                    let msg = buildInputMessage(src, dest, evt, null, input.dpt)
                                    input.send(msg)
                                }
                            })
                        break;

                            // node.inputUsers
                            //     .filter(input => input.topic == dest && input.notifyreadrequest)
                            //     .forEach(input => {
                            //         let msg = buildInputMessage(src, dest, evt, null, input.dpt)
                            //         input.send(msg)
                            //     })
                            // break;
                        
                    }
                    default: return
                }
            })
        }

        function buildInputMessage(src, dest, evt, value, inputDpt, _devicename) {
            // Resolve DPT and convert value if available
            var dpt = dptlib.resolve(inputDpt)
            var jsValue = null
            if (dpt && value) {
                var jsValue = dptlib.fromBuffer(value, dpt)
            }

            // Build final input message object
            return {
                topic: dest
                , payload: jsValue
                , knx:
                {
                    event: evt
                    , dpt: inputDpt
                    , dptDetails: dpt
                    , source: src
                    , destination: dest
                    , rawValue: value
                }
                , devicename: (typeof _devicename !== 'undefined') ? _devicename : ""
            }
        }

        node.on("close", function () {
            node.setStatus("disconnected")
            node.knxConnection.Disconnect()
            node.knxConnection = null
        })
    }
    RED.nodes.registerType("knxEasy-config", knxEasyConfigNode);
}
