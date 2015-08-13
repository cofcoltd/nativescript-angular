import {View} from 'ui/core/view';
import {ContentView} from 'ui/content-view';
import {Observable, EventData} from 'data/observable';
import {topmost} from 'ui/frame';
import {Button} from 'ui/button';
import {StackLayout} from 'ui/layouts/stack-layout';
import {Label} from 'ui/label';
import {TextField} from 'ui/text-field';
import {TextView} from 'ui/text-view';
import {Layout} from 'ui/layouts/layout';
import {NativeScriptView} from 'nativescript-angular/renderer';
import {AST} from 'angular2/src/change_detection/parser/ast';

interface ViewClass {
    new(): View
}

type EventHandler = (args: EventData) => void;

export class ViewNode {
    //TODO: move element registration and imports to a new module
    private static allowedElements: Map<string, ViewClass> = new Map<string, ViewClass>([
        ["button", Button],
        ["stacklayout", StackLayout],
        ["textfield", TextField],
        ["textview", TextView],
        ["label", Label],
        ["template", ContentView],
    ]);

    private eventListeners: Map<string, EventHandler> = new Map<string, EventHandler>();

    public nativeView: View;
    private _parentView: View;
    private _attachedToView: boolean = false;
    private cssClasses: Map<string, boolean> = new Map<string, boolean>();
    private static whiteSpaceSplitter = /\s+/;

    public children:Array<ViewNode> = [];

    constructor(public parentNode: ViewNode,
                public viewName: string,
                public attributes: Object = {}) {
        if (this.parentNode)
            this.parentNode.children.push(this);
    }

    print(depth: number = 0) {
        let line = "";

        for (let i = 0; i < depth; i++)
            line += "    "

        console.log(line + this.viewName + '(' + this._attachedToView + ') ');

        this.children.forEach(child => {
            child.print(depth + 1);
        });
    }

    printTree() {
        let root = this;
        while (root.parentNode !== null) {
            root = root.parentNode;
        }
        root.print();
    }

    get parentNativeView(): View {
        if (this._parentView)
            return this._parentView

        if (this.parentNode) {
            if(this.parentNode.viewName !== "template" && this.parentNode.nativeView) {
                this._parentView = this.parentNode.nativeView;
            } else {
                this._parentView = this.parentNode.parentNativeView;
            }
        }
        if (!this._parentView) {
            this._parentView = topmost().currentPage;
        }
        return this._parentView;
    }

    public attachToView(atIndex: number = -1) {
        console.log('ViewNode.attachToView ' + this.viewName);
        if (this._attachedToView) {
            console.log('already attached.');
            return;
        }

        this._attachedToView = true;

        this.createUI(atIndex);

        this.children.forEach(child => {
            child.attachToView();
        });
    }

    private createUI(attachAtIndex: number) {
        if (!ViewNode.allowedElements.has(this.viewName))
            return;

        console.log('createUI: ' + this.viewName +
            ', attachAt: ' + attachAtIndex +
            ', parent: ' + this.parentNode.viewName +
            ', parent UI ' + (<any>this.parentNativeView.constructor).name);

        let viewClass = ViewNode.allowedElements.get(this.viewName);
        if (!this.nativeView) {
            this.nativeView = new viewClass();
        } else {
            console.log('Reattaching old view: ' + this.viewName);
        }

        this.configureUI();

        if (this.parentNativeView instanceof Layout) {
            let parentLayout = <Layout>this.parentNativeView;
            if (attachAtIndex != -1) {
                console.log('Layout.insertChild');
                let indexOffset = 0;
                if (this.parentNode.viewName === "template") {
                    indexOffset = parentLayout.getChildIndex(this.parentNode.nativeView);
                }
                parentLayout.insertChild(indexOffset + attachAtIndex, this.nativeView);
            } else {
                parentLayout.addChild(this.nativeView);
            }
            this.attachUIEvents();
        } else if ((<any>this.parentNativeView)._addChildFromBuilder) {
            (<any>this.parentNativeView)._addChildFromBuilder(this.viewName, this.nativeView);
            this.attachUIEvents();
        } else {
            throw new Error("Parent view can't have children! " + this._parentView);
        }
    }

    private static propertyMaps: Map<Function, Map<string, string>> = new Map<Function, Map<string, string>>();

    private static getProperties(instance: any): Map<string, string> {
        let type = instance && instance.constructor;
        if (!type) {
            return new Map<string, string>();
        }

        if (!ViewNode.propertyMaps.has(type)) {
            var propMap = new Map<string, string>();
            for (var propName in instance) {
                propMap.set(propName.toLowerCase(), propName);
            }
            ViewNode.propertyMaps.set(type, propMap);
        }
        return ViewNode.propertyMaps.get(type);
    }

    private configureUI() {
        this.syncClasses();

        if (!this.attributes)
            return;

        for (var attribute in this.attributes) {
            let propertyValue = this.attributes[attribute];
            this.setAttribute(attribute, propertyValue);
        }
    }

    public setAttribute(attributeName: string, value: any): void {
        console.log('Setting attribute: ' + attributeName);

        var propMap = ViewNode.getProperties(this.nativeView);

        if (attributeName === "class") {
            this.setClasses(value);
        } else if (propMap.has(attributeName)) {
            // We have a lower-upper case mapped property.
            let propertyName = propMap.get(attributeName);
            this.nativeView[propertyName] = value;
        } else {
            // Unknown attribute value -- just set it to our object as is.
            this.nativeView[attributeName] = value;
        }
    }

    private attachUIEvents() {
        console.log('ViewNode.attachUIEvents: ' + this.viewName + ' ' + this.eventListeners.size);
        this.eventListeners.forEach((callback, eventName) => {
            this.attachNativeEvent(eventName, callback);
        });
    }

    private attachNativeEvent(eventName, callback) {
        this.nativeView.addEventListener(eventName, callback);
    }

    createEventListener(view: NativeScriptView, bindingIndex: number, eventName: string, eventLocals: AST) {
        console.log('createEventListener ' + this.viewName + ' ' + eventName + ' ' + eventLocals);

        let handler = (args: EventData) => {
            var locals = new Map<string, any>();
            locals.set('$event', args);
            //TODO: remove -- used for debug prints triggered from outside the renderer code.
            locals.set('$el', this);
            view.eventDispatcher.dispatchRenderEvent(bindingIndex, eventName, locals);
        }
        let zonedHandler = global.zone.bind(handler);
        this.eventListeners.set(eventName, zonedHandler);
        if (this._attachedToView) {
            this.attachNativeEvent(eventName, zonedHandler);
        }
    }

    public insertChildAt(index: number, childNode: ViewNode) {
        console.log('ViewNode.insertChildAt: ' + this.viewName + ' ' + index + ' ' + childNode.viewName);
        if (childNode.parentNode) {
            console.log('Moving child to new parent');
            childNode.parentNode.removeChild(childNode);
        }
        this.children.splice(index, 0, childNode);
        childNode.parentNode = this;
    }

    public removeChild(childNode: ViewNode) {
        childNode.parentNode = null;
        childNode._parentView = null;
        childNode._attachedToView = false;
        this.children = this.children.filter((item) => item !== childNode);

        if (childNode.nativeView) {
            let nativeParent = childNode.nativeView.parent;
            if (nativeParent instanceof Layout) {
                (<Layout>nativeParent).removeChild(childNode.nativeView);
            } else {
                nativeParent._removeView(childNode.nativeView);
            }
        }
    }

    public getChildIndex(childNode: ViewNode) {
        return this.children.indexOf(childNode);
    }

    setProperty(name: string, value: any) {
        console.log('ViewNode.setProperty ' + this.viewName + ' setProperty ' + name + ' ' + value);
        if (this.nativeView) {
            this.setAttribute(name, value);
        } else {
            console.log('setProperty called without a nativeView');
        }
    }

    public addClass(className: string): void {
        this.cssClasses.set(className, true);
        this.syncClasses();
    }

    public removeClass(className: string): void {
        this.cssClasses.delete(className);
        this.syncClasses();
    }

    public setClasses(classesValue: string): void {
        console.log('ViewNode.setClasses ' + classesValue);
        let classes = classesValue.split(ViewNode.whiteSpaceSplitter)
        classes.forEach((className) => this.cssClasses.set(className, true));
        this.syncClasses();
    }

    private syncClasses(): void {
        let classValue = (<any>Array).from(this.cssClasses.keys()).join(' ');
        if (this.nativeView && classValue) {
            this.nativeView.cssClass = classValue;
        }
    }

}
