import { loadGLTF } from "../../libs/loader.js";
import * as THREE from "../../libs/three.js-r132/build/three.module.js";
import { ARButton } from "../../libs/three.js-r132/examples/jsm/webxr/ARButton.js";

//explicacion del hit-test
//https://web.dev/ar-hit-test/

document.addEventListener("DOMContentLoaded", () => {
  const initialize = async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    let selectedItem = null;
    let touchDown = false;
    let prevTouchPosition = null;
    let placeButton = document.querySelector("#confirm-buttons #place");
    let cancelButton = document.querySelector("#confirm-buttons #cancel");
    let itemButton = document.querySelectorAll(".item-button");
    const itemNames = ["table", "chair", "chair2", "picture2"];

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(light);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    const arButton = ARButton.createButton(renderer, {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: document.body },
    });
    document.body.appendChild(renderer.domElement);
    //document.body.appendChild(arButton);

    const items = await addItems(itemNames, scene, arButton);

    const select = (selectItem, itemId) => {
      if (selectedItem === selectItem) return;

      for (var i = 0, m = items.length; i < m; i++) {
        items[i].visible = selectItem === items[i];
      }

      selectedItem = selectItem;
      uncheckButtons(itemButton);
      document.querySelector("#" + itemId).classList.add("select");
    };

    const cancelSelect = () => {
      if (selectedItem) selectedItem.visible = false;

      selectedItem = null;
      uncheckButtons(itemButton);
    };

    select(items[0], "table");

    // LISTENER INTERFACE BUTTONS
    itemButton.forEach((button) => {
      button.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();

        let indexItem = itemNames.indexOf(button.id);
        if (indexItem > -1) select(items[indexItem], button.id);
      });
    });

    placeButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      //clonarlo y posicionarlo
      const spawnItem = deepClone(selectedItem);
      setOpacity(spawnItem, 1.0);
      scene.add(spawnItem);

      cancelSelect();
    });

    cancelButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      cancelSelect();
    });

    // END LISTENER INTERFACE BUTTONS

    const controller = renderer.xr.getController(0);
    scene.add(controller);
    controller.addEventListener("selectstart", (e) => {
      touchDown = true;
    });
    controller.addEventListener("selectend", (e) => {
      touchDown = false;
      prevTouchPosition = null;
    });
    /*controller.addEventListener("select", () => {
      const geometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff * Math.random(),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.setFromMatrixPosition(reticle.matrix);
      mesh.scale.y = Math.random() * 2 + 1;
      scene.add(mesh);
    });*/

    renderer.xr.addEventListener("sessionstart", async () => {
      const session = renderer.xr.getSession();

      // kind of coordinate system, the origin is the current position of the viewer, which keeps changing
      // viewer is the person or the device
      const viewerReferenceSpace = await session.requestReferenceSpace(
        "viewer"
      );
      // care about the current position
      const hitTestSource = await session.requestHitTestSource({
        space: viewerReferenceSpace,
      });

      renderer.setAnimationLoop((timestamp, frame) => {
        if (!frame) return;

        const referenceSpace = renderer.xr.getReferenceSpace();

        // Para rotar el item cuando el usuario hace touch sobre el
        if (touchDown && selectedItem) {
          const viewerMatrix = new THREE.Matrix4().fromArray(
            frame.getViewerPose(referenceSpace).transform.inverse.matrix
          );
          const newPosition = controller.position.clone();
          newPosition.applyMatrix4(viewerMatrix); // change to viewer coordinate
          if (prevTouchPosition) {
            const deltaX = newPosition.x - prevTouchPosition.x;
            const deltaZ = newPosition.y - prevTouchPosition.y;
            selectedItem.rotation.y += deltaX * 30;
          }

          prevTouchPosition = newPosition;
        }

        // Para pintar el elemento seleccionado
        if (selectedItem) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const hitPose = hit.getPose(referenceSpace);

            selectedItem.visible = true;
            selectedItem.position.setFromMatrixPosition(
              new THREE.Matrix4().fromArray(hitPose.transform.matrix)
            );
          } else {
            selectedItem.visible = false;
          }
        }

        renderer.render(scene, camera);
      });
    });

    renderer.xr.addEventListener("sessionend", async () => {});
  };

  initialize();
});

const normalizeModel = (obj, height) => {
  // scale it according to height
  const bbox = new THREE.Box3().setFromObject(obj);
  const size = bbox.getSize(new THREE.Vector3());
  obj.scale.multiplyScalar(height / size.y);

  // reposition to center
  const bbox2 = new THREE.Box3().setFromObject(obj);
  const center = bbox2.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -center.y, -center.z);
};

// make clone object not sharing materials
const deepClone = (obj) => {
  const newObj = obj.clone();
  newObj.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
    }
  });
  return newObj;
};

// recursively set opacity
const setOpacity = (obj, opacity) => {
  obj.children.forEach((child) => {
    setOpacity(child, opacity);
  });
  if (obj.material) {
    obj.material.format = THREE.RGBAFormat; // required for opacity
    obj.material.opacity = opacity;
  }
};

const addItems = async (itemNames, scene, arButton) => {
  const itemHeights = [0.3, 0.7, 0.9, 1];
  const items = [];
  for (let i = 0; i < itemNames.length; i++) {
    const model = await loadGLTF(
      "../assets/models/mine/" + itemNames[i] + "/scene.gltf"
    );
    normalizeModel(model.scene, itemHeights[i]);
    const item = new THREE.Group();
    item.add(model.scene);
    item.visible = false;
    setOpacity(item, 0.3);
    items.push(item);
    scene.add(item);
  }

  addArButton(arButton);
  //alert("ITEMS1");
  return items;
};

const uncheckButtons = (itemButton) => {
  itemButton.forEach((button) => {
    button.classList.remove("select");
  });
};

const addArButton = (button) => {
  document.querySelector("#loading").style.display = "none";
  document.querySelector("#confirm-buttons").style.display = "flex";
  document.body.appendChild(button);
};
